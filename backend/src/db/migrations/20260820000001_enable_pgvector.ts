import type { Knex } from 'knex';

// Prerequisite for the candidate-evidence retrieval tables (profile_evidence,
// conversation_evidence) added right after this migration. Requires the postgres image to be
// pgvector-enabled (see docker-compose.yml) — plain postgres:18-alpine has no `vector` extension.
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP EXTENSION IF EXISTS vector');
}
