import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Generated post-session insight
// (spec §6) — distinct from candidate_profiles.profile_data.insights (Step 6's narrative
// profile, ProfileInsight in types/index.ts). This table is the personality-engine source of
// record; profile_data.insights gets populated from it once the insight generator exists
// (Iteration 5), not built here.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('insight', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // 'distinctiveness' | 'tension' | 'pattern' | 'context_dependence' |
    // 'environment_implication' | 'own_words'
    table.string('type', 30).notNullable();
    table.text('text').notNullable();
    table.jsonb('supporting_evidence_ids').notNullable().defaultTo('[]');
    table.boolean('surfaced_to_user').notNullable().defaultTo(false);
    table.boolean('surfaced_to_recruiter').notNullable().defaultTo(false);
    table.timestamps(true, true);

    table.index(['user_id']);
    table.index(['type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('insight');
}
