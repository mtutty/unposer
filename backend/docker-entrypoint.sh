#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."

# Wait for database to be ready
until nc -z postgres 5432; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "PostgreSQL is up - running migrations..."

if [ -f dist/db/migrate.js ]; then
  # Production image: no ts-node/knex CLI/knexfile at runtime (ts-node is a
  # devDependency, not installed here) — run migrations via the compiled JS
  # API instead. See src/db/migrate.ts for why.
  node dist/db/migrate.js
else
  # Dev image: full devDependencies installed, so the CLI can register
  # ts-node against knexfile.ts and run the *.ts migrations directly.
  npx knex migrate:latest
  echo "Current migration status:"
  npx knex migrate:status
fi

echo "Starting application..."

# Execute the main command (passed as arguments to this script)
exec "$@"
