import type { Knex } from 'knex';

// Step 3: goals, target roles/industries, location, situation, priorities. Factual/preference
// elicitation, distinct from the inferential Step 5 work. Channel-agnostic: the same row is
// filled in whether the candidate answers in-app or via the email thread.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('logistics_responses', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.jsonb('data').notNullable().defaultTo('{}');
    table.string('status', 20).notNullable().defaultTo('in_progress');
    table.timestamps(true, true);

    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('logistics_responses');
}
