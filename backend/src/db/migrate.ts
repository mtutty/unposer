/**
 * Standalone migration runner, invoked as compiled JS (`node dist/db/migrate.js`) by
 * docker-entrypoint.sh in the production image. Exists so the production runtime never needs
 * the knex CLI, a knexfile, or ts-node — those are dev-only tooling (ts-node in particular is a
 * devDependency, not installed in the production image at all) and the CLI's migration loader
 * needs one of them to read the *.ts migration files under src/db/migrations. Using the knex JS
 * API directly against the already-compiled dist/db/migrations/*.js sidesteps all of that.
 *
 * Dev keeps using `npx knex migrate:latest` (see docker-entrypoint.sh) — full devDependencies are
 * installed there, so the CLI/knexfile/ts-node path works as before and gets ts-node's helpful
 * TypeScript errors on a bad migration, which this compiled path can't.
 */
import { db } from './connection';

async function main(): Promise<void> {
  console.log('Running migrations...');
  const [batch, log] = await db.migrate.latest();

  if (log.length === 0) {
    console.log('Already up to date, no migrations to run.');
  } else {
    console.log(`Batch ${batch} run: ${log.length} migration(s)`);
    for (const name of log as string[]) {
      console.log(`  - ${name}`);
    }
  }

  const pending = await db.migrate.status();
  console.log(pending === 0 ? 'Migration status: up to date.' : `Migration status: ${pending} pending.`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
