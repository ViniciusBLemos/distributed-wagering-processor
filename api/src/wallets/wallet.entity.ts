
import { randomUUID } from 'node:crypto';
import { DecimalType } from '@mikro-orm/core';
import {
  Check,
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })

@Check({
  name: 'wallet_nonnegative_balance',
  expression: 'balance >= 0',
})
@Check({
  name: 'wallet_positive_version',
  expression: 'version >= 1',
})

export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property()
  playerId!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
  })
  balance: string = '0.00';

  @Property()
  version: number = 1;
}
