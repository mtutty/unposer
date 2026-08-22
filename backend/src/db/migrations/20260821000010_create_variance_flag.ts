import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Automatic variance-classification
// record (spec §4.4, §5.5 Function 2, §9.9) — written unconditionally on every ambiguous variance
// case, whether or not anyone reviews it. user_id here is the spec's "profile_id" (see
// dimension_score's migration comment on the same conceptual-vs-literal-profile naming).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('variance_flag', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('dimension', 50).notNullable();
    // 'topic_linked' | 'occasion_linked' | 'monotonic_drift' | 'ambiguous' — model's provisional read.
    table.string('flag_type', 20).notNullable();
    table.decimal('magnitude', 5, 2).notNullable();
    table.jsonb('contributing_evidence_ids').notNullable().defaultTo('[]');
    table.jsonb('topic_spread').notNullable().defaultTo('[]');
    table.jsonb('occasion_spread').notNullable().defaultTo('[]');
    // Raw model call/reasoning behind the provisional flag_type read, for audit and adjudication.
    table.jsonb('model_call').notNullable().defaultTo('{}');
    // Set once a human reviewer resolves the flag via the variance review queue (spec §5.5
    // Function 2) — same rater-identity caveat as calibration_rating.rater_id.
    table.string('human_adjudication', 20);
    table.string('adjudicated_by', 100);
    table.timestamp('adjudicated_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['user_id']);
    table.index(['dimension']);
    table.index(['flag_type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('variance_flag');
}
