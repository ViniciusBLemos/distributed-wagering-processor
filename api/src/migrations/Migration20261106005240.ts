import { Migration } from '@mikro-orm/migrations';

export class Migration20261106005240 extends Migration {

  override name = 'Migration20261106005240';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add "reference_attempts" int not null default 0, add "next_reference_attempt_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "reference_attempts", drop column "next_reference_attempt_at";`);
  }

}
