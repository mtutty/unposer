import type { Knex } from 'knex';

// One thread per (user, step). Covers both the Step 3 logistics conversation (app or email) and
// the Step 5 deep-prompt chat (app only). Email-channel bookkeeping (cap/silence/nudge) lives
// here so the app and email paths resolve to one unified state, never a separate "email profile".
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('conversation_threads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('step', 50).notNullable();
    // 'app' | 'email'
    table.string('channel', 20).notNullable();
    // 'active' | 'awaiting_reply' | 'stalled' | 'complete'
    table.string('status', 20).notNullable().defaultTo('active');
    table.integer('message_count').notNullable().defaultTo(0);
    table.integer('thread_cap').notNullable().defaultTo(40);
    table.timestamp('last_message_at');
    table.timestamp('last_nudge_at');
    table.timestamps(true, true);

    table.unique(['user_id', 'step']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('conversation_threads');
}
