import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Per-user, per-dimension aggregate
// score (spec §4.4). Versioned, not mutated in place: a re-score (topic-thread close, tier
// transition — Iteration 4+) inserts a new row rather than updating the last one, so history
// survives rubric changes and calibration re-runs. "profile" in the spec's §5 data-model diagram
// is conceptual (grouped by user), not a literal profile row — candidate_profiles is the separate
// narrative-profile table and is untouched by this one.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dimension_score', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('dimension', 50).notNullable();
    table.integer('version').notNullable().defaultTo(1);
    // Nullable: 'insufficient_signal' confidence emits no score (spec §4.3 STEP 5).
    table.integer('score');
    // 'high' | 'medium-high' | 'medium' | 'low' | 'insufficient_signal'
    table.string('confidence', 20).notNullable();
    // 'high' | 'medium-high' | 'medium' | 'suppressed' — derived presentation band (spec §4.4).
    table.string('band', 20);
    table.string('tier', 20);
    table.jsonb('contributing_evidence_ids').notNullable().defaultTo('[]');
    table.integer('distinct_occasions').notNullable().defaultTo(0);
    table.timestamp('computed_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'dimension', 'version']);
    table.index(['user_id']);
    table.index(['dimension']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('dimension_score');
}
