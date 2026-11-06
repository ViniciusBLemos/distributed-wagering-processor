import { Migration } from '@mikro-orm/migrations';

export class Migration20261106125705_financial_integrity extends Migration {


async up(): Promise<void> {
  this.addSql(`
    ALTER TABLE "wager_transactions"
    ADD CONSTRAINT "fk_wager_wallet"
    FOREIGN KEY ("wallet_id")
    REFERENCES "wallets" ("id")
    ON DELETE RESTRICT;
  `);

  this.addSql(`
    ALTER TABLE "wager_transactions"
    ADD CONSTRAINT "uq_wager_ledger_reference"
    UNIQUE ("id", "wallet_id", "amount", "currency");
  `);

  this.addSql(`
    ALTER TABLE "wallet_ledger_entries"
    ADD CONSTRAINT "fk_ledger_transaction"
    FOREIGN KEY ("transaction_id", "wallet_id", "amount", "currency")
    REFERENCES "wager_transactions"
      ("id", "wallet_id", "amount", "currency")
    ON DELETE RESTRICT;
  `);

  this.addSql(`
    ALTER TABLE "wallet_ledger_entries"
    ADD CONSTRAINT "ledger_valid_direction"
    CHECK ("direction" IN ('CREDIT', 'DEBIT'));
  `);

  this.addSql(`
    CREATE FUNCTION public.prevent_ledger_modification()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION
        'Ledger entries are immutable: UPDATE and DELETE are forbidden';
    END;
    $function$;
  `);

  this.addSql(`
    CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE
    ON public.wallet_ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_ledger_modification();
  `);
}

async down(): Promise<void> {
  this.addSql(`
    DROP TRIGGER IF EXISTS trg_ledger_immutable
    ON public.wallet_ledger_entries;
  `);

  this.addSql(`
    DROP FUNCTION IF EXISTS public.prevent_ledger_modification();
  `);

  this.addSql(`
    ALTER TABLE "wallet_ledger_entries"
    DROP CONSTRAINT IF EXISTS "ledger_valid_direction";
  `);

  this.addSql(`
    ALTER TABLE "wallet_ledger_entries"
    DROP CONSTRAINT IF EXISTS "fk_ledger_transaction";
  `);

  this.addSql(`
    ALTER TABLE "wager_transactions"
    DROP CONSTRAINT IF EXISTS "uq_wager_ledger_reference";
  `);

  this.addSql(`
    ALTER TABLE "wager_transactions"
    DROP CONSTRAINT IF EXISTS "fk_wager_wallet";
  `);
}


}
