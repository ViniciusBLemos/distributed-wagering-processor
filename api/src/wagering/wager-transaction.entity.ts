
import { randomUUID } from 'node:crypto';
import { DecimalType } from '@mikro-orm/core';
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['kind', 'referenceTransactionId'] })

export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property()
  providerId!: string;

  @Property()
  externalTransactionId!: string;

  @Property()
  idempotencyKey!: string;

  @Property()
  payloadHash!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property()
  playerId!: string;

  @Property()
  roundId!: string;

  @Property()
  gameId!: string;

  @Property({ length: 12 })
  kind!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
  })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ length: 30 })
  status!: string;

  @Property({
    type: DecimalType,
    precision: 20,
    scale: 2,
    nullable: true,
  })
  resultBalance?: string;

  @Property({ type: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Property({ nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ default: 0 })
  referenceAttempts: number = 0;

  @Property({ nullable: true })
  nextReferenceAttemptAt?: Date;

  @Property({ nullable: true })
  failureCode?: string;

  @Property({ nullable: true })
  processedAt?: Date;

  @Property()
  createdAt: Date = new Date();
}
