import type { Knex } from 'knex';

// Step 6: AI-generated narrative profile. correction_log records the "flag as not accurate ->
// targeted re-ask" loop, never a direct score/trait edit.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('candidate_profiles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    // 'draft' | 'pending_review' | 'approved'
    table.string('status', 20).notNullable().defaultTo('draft');
    table.integer('version').notNullable().defaultTo(1);
    table.jsonb('profile_data').notNullable();
    table.jsonb('correction_log').notNullable().defaultTo('[]');
    table.timestamp('approved_at');
    table.timestamps(true, true);

    table.index(['user_id']);
    table.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('candidate_profiles');
}
