
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../domain/money.js';
import { WalletEntity } from '../wallets/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../wallets/wallet-ledger.entity.js';
import { WagerTransactionEntity } from './wager-transaction.entity.js';

import { recordWagerEvents } from '../messaging/record-wager-events.js';

type WagerKind =
  | 'BET'
  | 'WIN'
  | 'LOSS'
  | 'REFUND'
  | 'ROLLBACK';

type WagerInput = {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
};

@Injectable()
export class WageringService {
  constructor(private readonly em: EntityManager) {}

  private parse(body: unknown): WagerInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload');
    }

    const data = body as Record<string, unknown>;

    for (const field of [
      'providerId',
      'externalTransactionId',
      'playerId',
      'walletId',
      'roundId',
      'gameId',
    ]) {
      if (
        typeof data[field] !== 'string' ||
        !(data[field] as string).trim()
      ) {
        throw new BadRequestException(`Invalid ${field}`);
      }
    }

    const uuidPattern =
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

    if (
      !uuidPattern.test(data.playerId as string) ||
      !uuidPattern.test(data.walletId as string)
    ) {
      throw new BadRequestException('Invalid UUID');
    }

    if (
      data.kind !== 'BET' &&
      data.kind !== 'WIN' &&
      data.kind !== 'LOSS' &&
      data.kind !== 'REFUND' &&
      data.kind !== 'ROLLBACK'
    ) {
      throw new BadRequestException('Invalid transaction kind');
    }

    const reference = data.referenceExternalTransactionId;

    if (
      (data.kind === 'REFUND' || data.kind === 'ROLLBACK') &&
      (typeof reference !== 'string' || !reference.trim())
    ) {
      throw new BadRequestException(
        'Reference transaction is required',
      );
    }

    if (
      reference !== undefined &&
      data.kind !== 'REFUND' &&
      data.kind !== 'ROLLBACK'
    ) {
      throw new BadRequestException(
        'Reference is not supported for this operation yet',
      );
    }

    const rawMoney = data.money as
      | Record<string, unknown>
      | undefined;

    let money: Money;

    try {
      money = Money.from({
        amount: rawMoney?.amount as string,
        currency: rawMoney?.currency as string,
      });
    } catch {
      throw new BadRequestException('Invalid money');
    }

    if (!money.isPositive()) {
      throw new BadRequestException('Amount must be positive');
    }

    if (money.currency !== 'BRL') {
      throw new BadRequestException('Only BRL is supported');
    }

    return {
      providerId: data.providerId as string,
      externalTransactionId: data.externalTransactionId as string,
      playerId: data.playerId as string,
      walletId: data.walletId as string,
      roundId: data.roundId as string,
      gameId: data.gameId as string,
      kind: data.kind,
      money: money.toJSON(),
      referenceExternalTransactionId:
        typeof reference === 'string' ? reference : undefined,
    };
  }

  private replay(tx: WagerTransactionEntity, hash: string) {
    if (tx.payloadHash !== hash) {
      throw new ConflictException(
        'Idempotency key used with different payload',
      );
    }

    if (
      tx.resultBalance === undefined ||
      !['PROCESSED', 'REJECTED', 'PENDING_REFERENCE']
        .includes(tx.status)
    ) {
      throw new ConflictException(
        'Transaction is not available for replay',
      );
    }

    return {
      transactionId: tx.id,
      status: tx.status,
      balance: {
        amount: tx.resultBalance,
        currency: tx.currency,
      },
      idempotentReplay: true,
      ...(tx.failureCode
        ? { failureCode: tx.failureCode }
        : {}),
    };
  }

  async submit(
    body: unknown,
    idempotencyKey?: string,
    externalEm?: EntityManager,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 255
    ) {
      throw new BadRequestException(
        'Idempotency-Key header is required',
      );
    }

    const input = this.parse(body);

    const canonical = JSON.stringify({
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId:
        input.referenceExternalTransactionId,
      roundId: input.roundId,
      walletId: input.walletId,
    });

    const hash = createHash('sha256')
      .update(canonical)
      .digest('hex');

    try {
      return await (externalEm ?? this.em).transactional(async (em) => {
        const existing = await em.findOne(
          WagerTransactionEntity,
          { idempotencyKey },
        );

        if (existing) {
          return this.replay(existing, hash);
        }

        const tx = new WagerTransactionEntity();

        tx.providerId = input.providerId;
        tx.externalTransactionId =
          input.externalTransactionId;
        tx.idempotencyKey = idempotencyKey;
        tx.payloadHash = hash;
        tx.walletId = input.walletId;
        tx.playerId = input.playerId;
        tx.roundId = input.roundId;
        tx.gameId = input.gameId;
        tx.kind = input.kind;
        tx.amount = input.money.amount;
        tx.currency = input.money.currency;
        tx.status = 'PENDING';
        tx.referenceExternalTransactionId =
          input.referenceExternalTransactionId;

        const wallet = await em.findOne(
          WalletEntity,
          { id: input.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        em.persist(tx);
        await em.flush();

        if (
          wallet.playerId !== input.playerId ||
          wallet.currency !== input.money.currency
        ) {
          throw new BadRequestException(
            'Wallet owner or currency mismatch',
          );
        }

        const current = Money.from({
          amount: wallet.balance,
          currency: wallet.currency,
        });
        const amount = Money.from(input.money);

        const finishWithoutMovement = (
          status: 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE',
          failureCode?: string,
        ) => {
          tx.status = status;
          tx.resultBalance = current.toString();

    if (status === 'PENDING_REFERENCE') {
        tx.nextReferenceAttemptAt = new Date(Date.now() + 2000);
    }

          if (failureCode) tx.failureCode = failureCode;

          //if (status !== 'PENDING_REFERENCE') {
            //tx.processedAt = new Date();
          //}

          recordWagerEvents(em, tx, current, current);

          return {
            transactionId: tx.id,
            status,
            ...(failureCode ? { failureCode } : {}),
            balance: current.toJSON(),
            idempotentReplay: false,
          };
        };

        if (input.kind === 'LOSS') {
          return finishWithoutMovement('PROCESSED');
        }

        let isDebit = input.kind === 'BET';
        let referenceId: string | undefined;

        if (
          input.kind === 'REFUND' ||
          input.kind === 'ROLLBACK'
        ) {
          const reference = await em.findOne(
            WagerTransactionEntity,
            {
              providerId: input.providerId,
              externalTransactionId:
                input.referenceExternalTransactionId!,
            },
          );

          if (
            !reference ||
            reference.status === 'PENDING' ||
            reference.status === 'PENDING_REFERENCE'
          ) {
            return finishWithoutMovement('PENDING_REFERENCE');
          }

          if (reference.status !== 'PROCESSED') {
            return finishWithoutMovement(
              'REJECTED',
              'INVALID_REFERENCE_STATUS',
            );
          }

          const validKind =
            input.kind === 'REFUND'
              ? reference.kind === 'BET'
              : ['BET', 'WIN', 'REFUND']
                  .includes(reference.kind);

          if (!validKind) {
            return finishWithoutMovement(
              'REJECTED',
              'INVALID_REFERENCE_KIND',
            );
          }

          const matches =
            reference.playerId === input.playerId &&
            reference.walletId === input.walletId &&
            reference.currency === input.money.currency &&
            reference.roundId === input.roundId &&
            reference.amount === input.money.amount;

          if (!matches) {
            return finishWithoutMovement(
              'REJECTED',
              'REFERENCE_MISMATCH',
            );
          }

          const previousReversal = await em.findOne(
            WagerTransactionEntity,
            {
              kind: input.kind,
              referenceTransactionId: reference.id,
              status: 'PROCESSED',
            },
          );

          if (previousReversal) {
            return finishWithoutMovement(
              'REJECTED',
              'ALREADY_REVERSED',
            );
          }

          referenceId = reference.id;

          isDebit =
            input.kind === 'ROLLBACK' &&
            (reference.kind === 'WIN' ||
              reference.kind === 'REFUND');
        }

        if (isDebit && current.isLessThan(amount)) {
          return finishWithoutMovement(
            'REJECTED',
            input.kind === 'ROLLBACK'
              ? 'ROLLBACK_INSUFFICIENT_FUNDS'
              : 'INSUFFICIENT_FUNDS',
          );
        }

        const next = isDebit
          ? current.subtract(amount)
          : current.add(amount);

        wallet.balance = next.toString();
        wallet.version += 1;

        if (referenceId) {
          tx.referenceTransactionId = referenceId;
        }

        const ledger = new WalletLedgerEntryEntity();

        ledger.walletId = wallet.id;
        ledger.transactionId = tx.id;
        ledger.direction = isDebit ? 'DEBIT' : 'CREDIT';
        ledger.amount = amount.toString();
        ledger.currency = amount.currency;
        ledger.balanceBefore = current.toString();
        ledger.balanceAfter = next.toString();

        em.persist(ledger);

        tx.status = 'PROCESSED';
        tx.resultBalance = next.toString();
        tx.processedAt = new Date();

  recordWagerEvents(em, tx, current, next);

        return {
          transactionId: tx.id,
          status: tx.status,
          balance: next.toJSON(),
          idempotentReplay: false,
        };
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const existing = await this.em.findOne(
          WagerTransactionEntity,
          { idempotencyKey },
        );

        if (existing) {
          return this.replay(existing, hash);
        }

        throw new ConflictException(
          'Transaction conflicts with an existing operation',
        );
      }

      throw error;
    }
  }

  private toDetails(tx: WagerTransactionEntity) {
    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: {
        amount: tx.amount,
        currency: tx.currency,
      },
      status: tx.status,
      balance: tx.resultBalance == null
        ? null
        : {
            amount: tx.resultBalance,
            currency: tx.currency,
          },
      referenceExternalTransactionId:
        tx.referenceExternalTransactionId ?? null,
      referenceTransactionId:
        tx.referenceTransactionId ?? null,
      failureCode: tx.failureCode ?? null,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString() ?? null,
    };
  }

  async findById(transactionId: string) {
    const uuid =
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

    if (!uuid.test(transactionId)) {
      throw new BadRequestException('Invalid transaction ID');
    }

    const tx = await this.em.findOne(
      WagerTransactionEntity,
      { id: transactionId },
    );

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toDetails(tx);
  }

  async findByProvider(
    providerId: string,
    externalTransactionId: string,
  ) {
    const tx = await this.em.findOne(
      WagerTransactionEntity,
      { providerId, externalTransactionId },
    );

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toDetails(tx);
  }
}
