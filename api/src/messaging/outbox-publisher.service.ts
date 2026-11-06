
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import {
  GetQueueUrlCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

import { OutboxMessageEntity } from './outbox-message.entity.js';
import { createSqsClient, QUEUES } from './sqs.js';

@Injectable()
export class OutboxPublisherService
  implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(
    OutboxPublisherService.name,
  );

  private readonly sqs = createSqsClient();
  private queueUrl = '';
  private busy = false;

  constructor(private readonly em: EntityManager) {}

  async onModuleInit(): Promise<void> {
    const result = await this.sqs.send(
      new GetQueueUrlCommand({
        QueueName: QUEUES.events,
      }),
    );

    if (!result.QueueUrl) {
      throw new Error('Outbox events queue not found');
    }

    this.queueUrl = result.QueueUrl;
    this.logger.log('Outbox publisher ready');
  }

  onModuleDestroy(): void {
    this.sqs.destroy();
  }

  @Interval(2000)
  async publishPending(): Promise<void> {
    if (this.busy || !this.queueUrl) return;

    this.busy = true;

    try {
      await this.em.transactional(async (em) => {
        const messages = await em.find(
          OutboxMessageEntity,
          {
            publishedAt: null,
            $or: [
              { nextAttemptAt: null },
              { nextAttemptAt: { $lte: new Date() } },
            ],
          },
          {
            limit: 1,
            orderBy: {
              occurredAt: 'ASC',
              id: 'ASC',
            },
            lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
          },
        );

        const message = messages[0];

        if (!message) return;

        try {
          await this.sqs.send(
            new SendMessageCommand({
              QueueUrl: this.queueUrl,
              MessageBody: JSON.stringify(message.payload),
              MessageGroupId: message.aggregateId,
              MessageDeduplicationId: message.id,
            }),
          );

          message.publishedAt = new Date();
          message.nextAttemptAt = undefined;

          this.logger.log(
            `Published ${message.eventType}: ${message.id}`,
          );
        } catch (error) {
          message.attempts += 1;

          const delaySeconds = Math.min(
            60,
            2 ** Math.min(message.attempts, 5),
          );

          message.nextAttemptAt = new Date(
            Date.now() + delaySeconds * 1000,
          );

          this.logger.warn(
            `Publish failed for ${message.id}: ${String(error)}`,
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Outbox processing error: ${String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }
}
