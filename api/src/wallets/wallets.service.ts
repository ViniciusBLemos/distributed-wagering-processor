
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';

import { Money } from '../domain/money.js';
import { WagerTransactionEntity } from '../wagering/wager-transaction.entity.js';
import { WalletEntity } from './wallet.entity.js';

import { WalletLedgerEntryEntity } from './wallet-ledger.entity.js';

import { recordWagerEvents } from '../messaging/record-wager-events.js';

@Injectable()
export class WalletsService {
  constructor(private readonly em: EntityManager) {}

  async create(body: unknown) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid request body');
    }

    const data = body as Record<string, unknown>;
    const initial = data.initialBalance;

    if (
      typeof data.playerId !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.playerId) ||
      !initial ||
      typeof initial !== 'object'
    ) {
      throw new BadRequestException('Invalid wallet data');
    }

    const balance = initial as Record<string, unknown>;

    if (
      typeof balance.amount !== 'string' ||
      typeof balance.currency !== 'string'
    ) {
      throw new BadRequestException('Invalid initial balance');
    }

    if (balance.currency !== 'BRL') {
      throw new BadRequestException('Only BRL is supported');
    }

    let money: Money;

    try {
      money = Money.from({
        amount: balance.amount,
        currency: balance.currency,
      });
    } catch {
      throw new BadRequestException('Invalid money amount');
    }

    try {
      return await this.em.transactional(async (em) => {
        const wallet = new WalletEntity();

        wallet.playerId = data.playerId as string;
        wallet.currency = money.currency;
        wallet.balance = money.toString();
        wallet.version = 1;

        em.persist(wallet);
  await em.flush();

        if (money.isPositive()) {
          const opening = new WagerTransactionEntity();

          opening.providerId = 'internal';
          opening.externalTransactionId = `opening:${wallet.id}`;
          opening.idempotencyKey = `opening:${wallet.id}`;
          opening.payloadHash = createHash('sha256')
            .update(JSON.stringify({
              walletId: wallet.id,
              initialBalance: money.toJSON(),
            }))
            .digest('hex');

          opening.walletId = wallet.id;
          opening.playerId = wallet.playerId;
          opening.roundId = 'OPENING';
          opening.gameId = 'OPENING';
          opening.kind = 'OPENING';
          opening.amount = money.toString();
          opening.currency = money.currency;
          opening.status = 'PROCESSED';
          opening.processedAt = new Date();

          em.persist(opening);
    await em.flush();

          const ledger = new WalletLedgerEntryEntity();

          ledger.walletId = wallet.id;
          ledger.transactionId = opening.id;
          ledger.direction = 'CREDIT';
          ledger.amount = money.toString();
          ledger.currency = money.currency;
          ledger.balanceBefore = '0.00';
          ledger.balanceAfter = money.toString();

          em.persist(ledger);

    recordWagerEvents(
        em,
        opening,
        Money.zero(money.currency),
        money,
    );

        }

        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: money.toJSON(),
          version: wallet.version,
        };
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'Wallet already exists for this player and currency',
        );
      }

      throw error;
    }
  }

  async findOne(walletId: string) {
    if (
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(walletId)
    ) {
      throw new BadRequestException('Invalid wallet ID');
    }

    const wallet = await this.em.findOne(WalletEntity, {
      id: walletId,
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: {
        amount: wallet.balance,
        currency: wallet.currency,
      },
      version: wallet.version,
    };
  }

  async listLedger(
    walletId: string,
    cursor?: string,
    limitParam?: string,
  ) {
    const uuidPattern =
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(walletId)) {
      throw new BadRequestException('Invalid wallet ID');
    }

    const wallet = await this.em.findOne(
      WalletEntity,
      { id: walletId },
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const limit = limitParam === undefined
      ? 50
      : Number(limitParam);

    if (
      (limitParam !== undefined &&
        !/^[1-9]\d*$/.test(limitParam)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        'Limit must be between 1 and 100',
      );
    }

    let filter: FilterQuery<WalletLedgerEntryEntity> = {
      walletId,
    };

    if (cursor !== undefined) {
      let decoded: unknown;

      try {
        decoded = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
      } catch {
        throw new BadRequestException('Invalid cursor');
      }

      if (
        !decoded ||
        typeof decoded !== 'object' ||
        Array.isArray(decoded)
      ) {
        throw new BadRequestException('Invalid cursor');
      }

      const value = decoded as Record<string, unknown>;

      if (
        typeof value.createdAt !== 'string' ||
        typeof value.id !== 'string' ||
        !uuidPattern.test(value.id)
      ) {
        throw new BadRequestException('Invalid cursor');
      }

      const createdAt = new Date(value.createdAt);

      if (
        Number.isNaN(createdAt.getTime()) ||
        createdAt.toISOString() !== value.createdAt
      ) {
        throw new BadRequestException('Invalid cursor date');
      }

      filter = {
        walletId,
        $or: [
          { createdAt: { $lt: createdAt } },
          {
            createdAt,
            id: { $lt: value.id },
          },
        ],
      };
    }

    const rows = await this.em.find(
      WalletLedgerEntryEntity,
      filter,
      {
        orderBy: {
          createdAt: 'DESC',
          id: 'DESC',
        },
        limit: limit + 1,
      },
    );

    const page = rows.slice(0, limit);
    const last = page.at(-1);

    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          ).toString('base64url')
        : null;

    return {
      entries: page.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: {
          amount: entry.amount,
          currency: entry.currency,
        },
        balanceBefore: {
          amount: entry.balanceBefore,
          currency: entry.currency,
        },
        balanceAfter: {
          amount: entry.balanceAfter,
          currency: entry.currency,
        },
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async reconcile(walletId: string) {
    const uuidPattern =
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(walletId)) {
      throw new BadRequestException('Invalid wallet ID');
    }

    const wallet = await this.em.findOne(
      WalletEntity,
      { id: walletId },
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const rows = await this.em.getConnection().execute(
      `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN direction = 'CREDIT' THEN amount
              WHEN direction = 'DEBIT' THEN -amount
              ELSE 0
            END
          ),
          0
        )::text AS calculated_balance,
        COUNT(*)::text AS checked_entries
      FROM wallet_ledger_entries
      WHERE wallet_id = ?
      `,
      [walletId],
    );

    const result = rows[0] as {
      calculated_balance: string;
      checked_entries: string;
    };

    const stored = Money.from({
      amount: wallet.balance,
      currency: wallet.currency,
    });

    const calculated = Money.from({
      amount: result.calculated_balance,
      currency: wallet.currency,
    });

    const difference = stored.subtract(calculated);
    const consistent = stored.equals(calculated);

    if (!consistent) {
      console.error(
        'Wallet reconciliation divergence',
        {
          walletId,
          stored: stored.toString(),
          calculated: calculated.toString(),
        },
      );
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: Number(result.checked_entries),
    };
  }

}
