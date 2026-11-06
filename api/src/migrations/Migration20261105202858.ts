import { Migration } from '@mikro-orm/migrations';

export class Migration20261105202858 extends Migration {

  override name = 'Migration20261105202858';

  override up(): void | Promise<void> {
    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "wallet_id" uuid not null, "player_id" varchar(255) not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "kind" varchar(12) not null, "amount" numeric(20,2) not null, "currency" varchar(3) not null, "status" varchar(30) not null, "reference_external_transaction_id" varchar(255) null, "failure_code" varchar(255) null, "processed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(6) not null, "amount" numeric(20,2) not null, "currency" varchar(3) not null, "balance_before" numeric(20,2) not null, "balance_after" numeric(20,2) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique" unique ("wallet_id", "transaction_id");`);

    this.addSql(`alter table "wallets" add constraint "wallet_positive_version" check (version >= 1);`);
    this.addSql(`alter table "wallets" add constraint "wallet_nonnegative_balance" check (balance >= 0);`);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_valid_movement" check (
    (direction = 'CREDIT'
      AND balance_after = balance_before + amount)
    OR
    (direction = 'DEBIT'
      AND balance_after = balance_before - amount)
  );`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_valid_balance" check (balance_before >= 0 AND balance_after >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_positive_amount" check (amount > 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);

    this.addSql(`alter table "wallets" drop constraint "wallet_positive_version";`);
    this.addSql(`alter table "wallets" drop constraint "wallet_nonnegative_balance";`);
  }

}
