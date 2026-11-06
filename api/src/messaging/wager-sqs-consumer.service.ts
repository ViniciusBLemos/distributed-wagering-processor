
import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import type { Message } from '@aws-sdk/client-sqs';

import { WageringService } from '../wagering/wagering.service.js';
import { InboxMessageEntity } from './inbox-message.entity.js';
import { createSqsClient, QUEUES } from './sqs.js';

type WagerEnvelope = {
  messageId: string;
  type: 'WagerTransactionRequested';
  data: Record<string, unknown> & {
    idempotencyKey: string;
  };
};

@Injectable()
export class WagerSqsConsumerService
  implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(
    WagerSqsConsumerService.name,
  );

  private readonly sqs = createSqsClient();
  private queueUrl = '';
  private stopping = false;
  private polling?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly wagering: WageringService,
  ) {}

  async onModuleInit(): Promise<void> {
    const result = await this.sqs.send(
      new GetQueueUrlCommand({
        QueueName: QUEUES.transactions,
      }),
    );

    if (!result.QueueUrl) {
      throw new Error('Wager transactions queue not found');
    }

    this.queueUrl = result.QueueUrl;
    this.polling = this.poll();

    this.logger.log('Wager SQS consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.polling;
    this.sqs.destroy();
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 5,
            VisibilityTimeout: 60,
          }),
        );

        for (const message of response.Messages ?? []) {
          if (this.stopping) break;
          await this.processMessage(message);
        }
      } catch (error) {
        if (this.stopping) break;

        this.logger.error(
          `SQS polling error: ${String(error)}`,
        );

        await new Promise<void>((resolve) =>
          setTimeout(resolve, 1500),
        );
      }
    }
  }

  private parseMessage(body: string): WagerEnvelope {
    const parsed: unknown = JSON.parse(body);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid message');
    }

    const envelope = parsed as Record<string, unknown>;
    const data = envelope.data;

    if (
      envelope.type !== 'WagerTransactionRequested' ||
      typeof envelope.messageId !== 'string' ||
      !envelope.messageId.trim() ||
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      typeof (data as Record<string, unknown>)
        .idempotencyKey !== 'string' ||
      !(data as Record<string, unknown>).idempotencyKey
    ) {
      throw new Error('Invalid message envelope');
    }

    return parsed as WagerEnvelope;
  }

  private async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      this.logger.error('Message missing body or receipt handle');
      return;
    }

    try {
      const envelope = this.parseMessage(message.Body);

      const hash = createHash('sha256')
        .update(message.Body)
        .digest('hex');

      await this.em.transactional(async (em) => {
        const existing = await em.findOne(
          InboxMessageEntity,
          {
            consumerName: 'wager-sqs-consumer',
            messageId: envelope.messageId,
          },
        );

        if (existing) {
          if (existing.payloadHash !== hash) {
            throw new Error('Message ID payload conflict');
          }

          if (!existing.processedAt) {
            throw new Error('Message not yet processed');
          }

          this.logger.log(
            `Duplicate message: ${envelope.messageId}`,
          );

          return;
        }

        const inbox = new InboxMessageEntity();

        inbox.consumerName = 'wager-sqs-consumer';
        inbox.messageId = envelope.messageId;
        inbox.payloadHash = hash;

        em.persist(inbox);
        await em.flush();

        await this.wagering.submit(
          envelope.data,
          envelope.data.idempotencyKey,
          em,
        );

        inbox.processedAt = new Date();
      });

      await this.sqs.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );

      this.logger.log(
        `Message processed: ${message.MessageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Processing failed: ${String(error)}`,
      );
    }
  }
}
