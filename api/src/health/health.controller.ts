
import {
  Controller,
  Get,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';

import { EntityManager } from '@mikro-orm/postgresql';
import { GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

import {
  createSqsClient,
  QUEUES,
} from '../messaging/sqs.js';

@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly sqs = createSqsClient();

  constructor(private readonly em: EntityManager) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'jungle-wagering-processor',
    };
  }

  @Get('ready')
  async ready() {
    const results = await Promise.allSettled([
      this.em.getConnection().execute('SELECT 1'),
      this.sqs.send(
        new GetQueueUrlCommand({
          QueueName: QUEUES.transactions,
        }),
      ),
    ]);

    const postgres = results[0].status === 'fulfilled';

    const sqs =
      results[1].status === 'fulfilled' &&
      Boolean(results[1].value.QueueUrl);

    if (!postgres || !sqs) {
      throw new ServiceUnavailableException({
        status: 'unready',
        checks: {
          postgres,
          sqs,
        },
      });
    }

    return {
      status: 'ready',
      checks: {
        postgres: true,
        sqs: true,
      },
    };
  }

  
  @Get('metrics')
  async metrics() {
    const connection = this.em.getConnection();

    const [statuses, outbox, retries, latency] =
      await Promise.all([
        connection.execute(
          `SELECT status, COUNT(*)::int AS total
           FROM wager_transactions
           GROUP BY status`,
        ),
        connection.execute(
          `SELECT
             COUNT(*) FILTER (
               WHERE published_at IS NULL
             )::int AS pending,
             COUNT(*) FILTER (
               WHERE published_at IS NOT NULL
             )::int AS published,
             COALESCE(
               MAX(EXTRACT(EPOCH FROM NOW() - occurred_at))
                 FILTER (WHERE published_at IS NULL),
               0
             )::float8 AS oldest_pending_seconds
           FROM outbox_messages`,
        ),
        connection.execute(
          `SELECT
             COALESCE(SUM(reference_attempts), 0)::int
               AS total
           FROM wager_transactions`,
        ),
        connection.execute(
          `SELECT
             COALESCE(
               AVG(
                 EXTRACT(EPOCH FROM processed_at - created_at)
                 * 1000
               ),
               0
             )::float8 AS average_ms
           FROM wager_transactions
           WHERE processed_at IS NOT NULL`,
        ),
      ]);

    const dlq = await this.sqs.send(
      new GetQueueUrlCommand({
        QueueName: QUEUES.dlq,
      }),
    );

    if (!dlq.QueueUrl) {
      throw new ServiceUnavailableException(
        'DLQ not available',
      );
    }

    const attributes = await this.sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
        ],
      }),
    );

    return {
      timestamp: new Date().toISOString(),
      transactionsByStatus: Object.fromEntries(
        (
          statuses as unknown as Array<{
            status: string;
            total: number;
          }>
        ).map((row) => [row.status, row.total]),
      ),
      outbox: outbox[0],
      pendingReferenceRetryAttempts: retries[0].total,
      averageProcessingLatencyMs: latency[0].average_ms,
      dlqApproximateMessages: Number(
        attributes.Attributes?.ApproximateNumberOfMessages
          ?? 0,
      ),
    };
  }


  onModuleDestroy() {
    this.sqs.destroy();
  }
}
