import type { Knex } from 'knex';

// Raw substrate evidence tier: one row per resume section / logistics summary / deep-prompt Q&A
// exchange, embedded for semantic retrieval from sandbox/share chat when the compact profile
// digest (profile_evidence) doesn't have enough specificity to answer a question. Historical —
// never deleted on profile regeneration, so the actual record of what was said is preserved even
// after a correction supersedes what it means. (Resume rows are the one exception: re-confirming
// a corrected resume does delete-and-reinsert its rows — see EvidenceService.indexResumeSubstrate.)
// Deliberately a separate table from profile_evidence, not just a source_type tag on one table,
// so retrieval can prefer the distilled/current tier structurally — see EvidenceService.search.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('conversation_evidence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // 'resume' | 'logistics' | 'deep_prompt_turn'
    table.string('source_type', 30).notNullable();
    // originating row id where one exists (resumes.id, or the assistant message id closing a
    // deep-prompt Q&A pair); null for logistics (one merged chunk, no single source row).
    table.uuid('source_id');
    table.text('content').notNullable();
    table.specificType('embedding', 'vector(1536)').notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id']);
    table.index(['user_id', 'source_type']);
  });

  await knex.raw(`
    CREATE INDEX conversation_evidence_embedding_idx ON conversation_evidence
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128)
  `);
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('conversation_evidence');
}
