import { Migration } from '@mikro-orm/migrations';

export class Migration20261105205828 extends Migration {

  override name = 'Migration20261105205828';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add "result_balance" numeric(20,2) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "result_balance";`);
  }

}
