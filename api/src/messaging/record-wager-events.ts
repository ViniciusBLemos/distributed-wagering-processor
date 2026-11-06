
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../domain/money.js';
import { WagerTransactionEntity } from '../wagering/wager-transaction.entity.js';
import {
  WagerTransactionProcessedEvent,
  WagerTransactionRejectedEvent,
  WagerTransactionPendingReferenceEvent,
  WalletBalanceChangedEvent,
} from './integration-events.js';
import { saveEvent } from './save-event.js';

export function recordWagerEvents(
  em: EntityManager,
  tx: WagerTransactionEntity,
  balanceBefore: Money,
  balanceAfter: Money,
): void {
  const data = {
    transactionId: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    playerId: tx.playerId,
    walletId: tx.walletId,
    kind: tx.kind,
    status: tx.status,
    money: {
      amount: tx.amount,
      currency: tx.currency,
    },
    balance: balanceAfter.toJSON(),
    ...(tx.failureCode
      ? { failureCode: tx.failureCode }
      : {}),
  };

  switch (tx.status) {
    case 'PROCESSED':
      saveEvent(
        em,
        new WagerTransactionProcessedEvent(
          tx.walletId,
          tx.id,
          data,
        ),
      );
      break;

    case 'REJECTED':
      saveEvent(
        em,
        new WagerTransactionRejectedEvent(
          tx.walletId,
          tx.id,
          data,
        ),
      );
      break;

    case 'PENDING_REFERENCE':
      saveEvent(
        em,
        new WagerTransactionPendingReferenceEvent(
          tx.walletId,
          tx.id,
          data,
        ),
      );
      break;

    default:
      throw new Error(
        `Cannot publish event for status ${tx.status}`,
      );
  }

  if (!balanceBefore.equals(balanceAfter)) {
    if (tx.status !== 'PROCESSED') {
      throw new Error(
        'Unprocessed transaction cannot change balance',
      );
    }

    saveEvent(
      em,
      new WalletBalanceChangedEvent(
        tx.walletId,
        tx.id,
        {
          transactionId: tx.id,
          walletId: tx.walletId,
          balanceBefore: balanceBefore.toJSON(),
          balanceAfter: balanceAfter.toJSON(),
        },
      ),
    );
  }
}
