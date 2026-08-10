#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."

# Wait for database to be ready
until nc -z postgres 5432; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "PostgreSQL is up - checking migrations..."

# Run migrations
npx knex migrate:latest

if [ $? -eq 0 ]; then
  echo "Migrations completed successfully"
else
  echo "Migration failed!"
  exit 1
fi

# Check migration status
echo "Current migration status:"
npx knex migrate:status

echo "Starting application..."

# Execute the main command (passed as arguments to this script)
exec "$@"
