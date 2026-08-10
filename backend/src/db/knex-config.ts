import type { Knex } from 'knex';

// Shared by src/db/connection.ts (runtime) and the root knexfile.ts (knex CLI). Kept inside src/
// so it stays within tsconfig's rootDir — the root knexfile.ts just re-exports this.
const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL || {
      host: 'postgres',
      port: 5432,
      user: 'appuser',
      password: 'apppass',
      database: 'appdb'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './src/db/migrations'
    },
    seeds: {
      directory: './src/db/seeds'
    }
  },

  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './src/db/migrations'
    }
  }
};

export default config;
