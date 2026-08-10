import type { Knex } from 'knex';

// Unified message log for both chat and email-simulation channels. There is deliberately no
// separate "email messages" table — one path, one history, per spec Step 4.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('thread_id').references('id').inTable('conversation_threads').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('role', 20).notNullable();
    table.text('content').notNullable();
    table.string('channel', 20).notNullable();
    table.string('step', 50).notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['thread_id']);
    table.index(['user_id', 'step']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('messages');
}
