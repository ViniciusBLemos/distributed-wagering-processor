
import {
  Controller,
  Get,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';

import { EntityManager } from '@mikro-orm/postgresql';
import { GetQueueUrlCommand } from '@aws-sdk/client-sqs';

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

  onModuleDestroy() {
    this.sqs.destroy();
  }
}
