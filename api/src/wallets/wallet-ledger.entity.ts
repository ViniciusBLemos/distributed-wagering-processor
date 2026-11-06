
import { randomUUID } from 'node:crypto';
import { DecimalType } from '@mikro-orm/core';
import {
  Check,
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ properties: ['walletId', 'transactionId'] })
@Check({
  name: 'ledger_positive_amount',
  expression: 'amount > 0',
})
@Check({
  name: 'ledger_valid_balance',
  expression: 'balance_before >= 0 AND balance_after >= 0',
})
@Check({
  name: 'ledger_valid_movement',
  expression: `
    (direction = 'CREDIT'
      AND balance_after = balance_before + amount)
    OR
    (direction = 'DEBIT'
      AND balance_after = balance_before - amount)
  `,
})
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  transactionId!: string;

  @Property({ length: 6 })
  direction!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
  })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
  })
  balanceBefore!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
  })
  balanceAfter!: string;

  @Property()
  createdAt: Date = new Date();
}
