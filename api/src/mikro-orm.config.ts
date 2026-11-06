import 'dotenv/config';
import 'reflect-metadata';

import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';

import { WagerTransactionEntity } from './wagering/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from './wallets/wallet-ledger.entity.js';

import { WalletEntity } from './wallets/wallet.entity.js';

import { OutboxMessageEntity } from './messaging/outbox-message.entity.js';
import { InboxMessageEntity } from './messaging/inbox-message.entity.js';

export default defineConfig({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '5432'),

  user: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD ?? '',
  dbName: process.env.DB_NAME ?? 'jungle_db',

  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    OutboxMessageEntity,
    InboxMessageEntity,
  ],
  metadataProvider: ReflectMetadataProvider,

  extensions: [Migrator],

  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
    emit: 'ts',
  },
});
