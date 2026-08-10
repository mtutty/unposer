import type { Knex } from 'knex';

// Step 7: the candidate's own practice run at the "virtual interview" — chatting with their
// approved profile as if they were a recruiter. Kept separate from `messages` because it never
// feeds the profile directly; a flagged gap is what routes back into Step 5/6.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('sandbox_messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('role', 20).notNullable();
    table.text('content').notNullable();
    table.boolean('flagged_gap').notNullable().defaultTo(false);
    table.text('gap_note');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('sandbox_messages');
}
