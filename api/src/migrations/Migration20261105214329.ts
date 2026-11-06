import { Migration } from '@mikro-orm/migrations';

export class Migration20261105214329 extends Migration {

  override name = 'Migration20261105214329';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add "reference_transaction_id" uuid null;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_reference_transaction_id_unique" unique ("kind", "reference_transaction_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_kind_reference_transaction_id_unique";`);
    this.addSql(`alter table "wager_transactions" drop column "reference_transaction_id";`);
  }

}
