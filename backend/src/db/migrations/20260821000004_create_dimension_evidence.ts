import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Scoring evidence extracted from one
// exchange, one dimension at a time (spec §4.1). Deliberately named dimension_evidence, not
// profile_evidence/conversation_evidence — those are the existing pgvector RAG tables (see their
// migrations) and serve retrieval, not scoring. The two converge in Iteration 8 of the
// implementation plan, not before. Immutable once written (spec §5: "scores are versioned,
// evidence is immutable") — no updated_at.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dimension_evidence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('exchange_id').notNullable().references('id').inTable('exchange').onDelete('CASCADE');
    // One of the 11 dimension keys, e.g. 'emotional_stability' — see DimensionKey in types/index.ts.
    table.string('dimension', 50).notNullable();
    table.text('span').notNullable();
    // 'low' | 'high' — toward the 0 pole or the 100 pole.
    table.string('direction', 10).notNullable();
    // 'strong' | 'moderate' | 'weak'
    table.string('strength', 10).notNullable();
    // 'explicit_statement' | 'behavioral_report' | 'attribution_pattern' | 'linguistic_marker'
    table.string('type', 30).notNullable();
    // Facet-level tag, dimension-level score (spec §9.1, decided) — tagged now so facets can be
    // rolled up later without re-scoring; no facet scores emitted in v1.
    table.string('facet', 50);
    table.text('note');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['exchange_id']);
    table.index(['dimension']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('dimension_evidence');
}
