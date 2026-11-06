
import { randomUUID } from 'node:crypto';
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property()
  consumerName!: string;

  @Property()
  messageId!: string;

  @Property()
  payloadHash!: string;

  @Property()
  receivedAt: Date = new Date();

  @Property({ nullable: true })
  processedAt?: Date;
}
