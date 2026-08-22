import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). One row per user tracking
// personality-engine tier/pacing (spec §3.5) — distinct from flow_progress, which tracks the 6
// onboarding steps. The two connect at exactly one point (flow addendum §2): deep_prompts flips
// complete in flow_progress on first reaching tier 'sketch' here — wired in Iteration 5, not
// this one.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('progression', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    // 'none' | 'sketch' | 'core_persona' | 'in_depth' | 'ongoing'
    table.string('tier', 20).notNullable().defaultTo('none');
    table.jsonb('dimensions_at_confidence').notNullable().defaultTo('[]');
    // 'whenever' | 'one_a_week' | 'all_now' — user-set, changeable (spec §3.5).
    table.string('pace_preference', 20).notNullable().defaultTo('one_a_week');
    table.string('next_question_id', 50);
    table.timestamp('last_contact_at');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('progression');
}
