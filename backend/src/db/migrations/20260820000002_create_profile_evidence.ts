import type { Knex } from 'knex';

// Distilled, authoritative evidence tier: one row per current-profile insight/STAR story,
// embedded for semantic retrieval from sandbox/share chat (see evidence.service.ts). Always
// reflects only the *current* candidate_profiles row for a user — wholly deleted and reinserted
// on every profile regeneration (see EvidenceService.indexDistilledProfile), so a stale,
// since-corrected insight can never outrank the current one here. Kept in a separate table from
// conversation_evidence (raw substrate) specifically so retrieval can prefer this tier
// structurally rather than by similarity-score coincidence — see EvidenceService.search.
//
// hnsw over ivfflat: this app's workload is read-heavy (candidate/recruiter chat queries) with
// infrequent writes (profile regeneration only), and query precision matters more than
// index-build speed — hnsw's tradeoff (costlier build/update, better recall/latency per query)
// fits that better than ivfflat's.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('profile_evidence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // 'insight' | 'star_story'
    table.string('kind', 20).notNullable();
    // profile_data.insights[].id, or a synthetic 'star-N' index for STAR stories (which have no
    // stable id in the profile schema).
    table.string('source_ref', 100).notNullable();
    table.text('content').notNullable();
    // Knex has no vector-aware column builder — specificType is the standard escape hatch.
    table.specificType('embedding', 'vector(1536)').notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamps(true, true);

    table.index(['user_id']);
  });

  // Raw SQL: `USING hnsw` isn't expressible via Knex's index builder.
  await knex.raw(`
    CREATE INDEX profile_evidence_embedding_idx ON profile_evidence
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128)
  `);
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('profile_evidence');
}
