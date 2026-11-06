
import { randomUUID } from 'node:crypto';
import {
  Entity,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  aggregateId!: string;

  @Property()
  eventType!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property()
  occurredAt: Date = new Date();

  @Property()
  attempts: number = 0;

  @Property({ nullable: true })
  nextAttemptAt?: Date;

  @Property({ nullable: true })
  publishedAt?: Date;
}
