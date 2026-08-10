// Re-exports the shared config so the knex CLI (`npx knex migrate:*`) and the app runtime
// (src/db/connection.ts) stay in sync. See src/db/knex-config.ts.
export { default } from './src/db/knex-config';
