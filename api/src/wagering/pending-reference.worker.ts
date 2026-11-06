
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LockMode } from '@mikro-orm/core';
import { CreateRequestContext } from '@mikro-orm/decorators/legacy';
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../domain/money.js';
import { WalletEntity } from '../wallets/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../wallets/wallet-ledger.entity.js';
import { recordWagerEvents } from '../messaging/record-wager-events.js';
import { WagerTransactionEntity } from './wager-transaction.entity.js';

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private running = false;

  constructor(private readonly em: EntityManager) {}

  @Interval(3000)
  @CreateRequestContext()
  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.em.transactional(async (em) => {
        const now = new Date();

        const pending = await em.find(
          WagerTransactionEntity,
          {
            status: 'PENDING_REFERENCE',
            $or: [
              { nextReferenceAttemptAt: null },
              { nextReferenceAttemptAt: { $lte: now } },
            ],
          },
          {
            limit: 1,
            orderBy: { createdAt: 'ASC', id: 'ASC' },
            lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
          },
        );

        const tx = pending[0];
        if (!tx) return;

        const wallet = await em.findOne(
          WalletEntity,
          { id: tx.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        if (!wallet) {
          throw new Error(`Wallet ${tx.walletId} not found`);
        }

        const before = Money.from({
          amount: wallet.balance,
          currency: wallet.currency,
        });

        const reject = (code: string): void => {
          tx.status = 'REJECTED';
          tx.failureCode = code;
          tx.resultBalance = before.toString();
          tx.processedAt = new Date();
          tx.nextReferenceAttemptAt = undefined;

          recordWagerEvents(em, tx, before, before);
        };

        if (!tx.referenceExternalTransactionId) {
          reject('REFERENCE_REQUIRED');
          return;
        }

        const reference = await em.findOne(
          WagerTransactionEntity,
          {
            providerId: tx.providerId,
            externalTransactionId:
              tx.referenceExternalTransactionId,
          },
        );

        if (
          !reference ||
          reference.status === 'PENDING' ||
          reference.status === 'PENDING_REFERENCE'
        ) {
          tx.referenceAttempts += 1;

          if (tx.referenceAttempts >= 8) {
            reject('REFERENCE_NOT_FOUND');
            return;
          }

          const delay = Math.min(
            120000,
            2000 * 2 ** tx.referenceAttempts,
          );

          tx.nextReferenceAttemptAt = new Date(
            Date.now() + delay,
          );
          return;
        }

        if (reference.status !== 'PROCESSED') {
          reject('INVALID_REFERENCE_STATUS');
          return;
        }

        const validKind =
          tx.kind === 'REFUND'
            ? reference.kind === 'BET'
            : tx.kind === 'ROLLBACK' &&
              ['BET', 'WIN', 'REFUND'].includes(reference.kind);

        if (!validKind) {
          reject('INVALID_REFERENCE_KIND');
          return;
        }

        if (
          reference.walletId !== tx.walletId ||
          reference.playerId !== tx.playerId ||
          reference.currency !== tx.currency ||
          reference.roundId !== tx.roundId ||
          reference.amount !== tx.amount
        ) {
          reject('REFERENCE_MISMATCH');
          return;
        }

        const previous = await em.findOne(
          WagerTransactionEntity,
          {
            kind: tx.kind,
            referenceTransactionId: reference.id,
            status: 'PROCESSED',
          },
        );

        if (previous) {
          reject('ALREADY_REVERSED');
          return;
        }

        const amount = Money.from({
          amount: tx.amount,
          currency: tx.currency,
        });

        const isDebit =
          tx.kind === 'ROLLBACK' &&
          ['WIN', 'REFUND'].includes(reference.kind);

        if (isDebit && before.isLessThan(amount)) {
          reject('ROLLBACK_INSUFFICIENT_FUNDS');
          return;
        }

        const after = isDebit
          ? before.subtract(amount)
          : before.add(amount);

        const maxBalance = Money.from({
          amount: '999999999999999999.99',
          currency: wallet.currency,
        });

        if (maxBalance.isLessThan(after)) {
          reject('BALANCE_OVERFLOW');
          return;
        }

        wallet.balance = after.toString();
        wallet.version += 1;

        tx.referenceTransactionId = reference.id;
        tx.status = 'PROCESSED';
        tx.resultBalance = after.toString();
        tx.processedAt = new Date();
        tx.nextReferenceAttemptAt = undefined;

        const ledger = new WalletLedgerEntryEntity();
        ledger.walletId = wallet.id;
        ledger.transactionId = tx.id;
        ledger.direction = isDebit ? 'DEBIT' : 'CREDIT';
        ledger.amount = amount.toString();
        ledger.currency = amount.currency;
        ledger.balanceBefore = before.toString();
        ledger.balanceAfter = after.toString();

        em.persist(ledger);
        recordWagerEvents(em, tx, before, after);

        this.logger.log(`Resolved pending transaction ${tx.id}`);
      }, { clear: true });
    } catch (error) {
      this.logger.error(`Pending worker failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
