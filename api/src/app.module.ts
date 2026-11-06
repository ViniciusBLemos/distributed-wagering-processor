
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';

import mikroOrmConfig from './mikro-orm.config.js';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { WalletsController } from './wallets/wallets.controller.js';
import { WalletsService } from './wallets/wallets.service.js';

import { WageringController } from './wagering/wagering.controller.js';
import { WageringService } from './wagering/wagering.service.js';
import { PendingReferenceWorker } from './wagering/pending-reference.worker.js';
import { ProvidersController } from './wagering/providers.controller.js';

import { OutboxPublisherService } from './messaging/outbox-publisher.service.js';
import { WagerSqsConsumerService } from './messaging/wager-sqs-consumer.service.js';

import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AppController,
    WalletsController,
    WageringController,
    ProvidersController,
    HealthController,
  ],
  providers: [
    AppService,
    WalletsService,
    WageringService,
    OutboxPublisherService,
    WagerSqsConsumerService,
    PendingReferenceWorker,
  ],
})
export class AppModule {}
