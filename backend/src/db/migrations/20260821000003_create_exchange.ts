import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). One row per message within a
// topic_thread. occasion_id is the load-bearing field (spec §5) — the candidate's local calendar
// date, not a raw timestamp truncation. No per-user timezone is captured anywhere in this
// codebase yet (checked: no timezone/locale field on users, logistics_responses, or anywhere
// else), so Iteration 1 falls back to the UTC calendar date of sent_at — see utils/occasion.ts.
// Revisit once a real timezone source exists (candidate signup, browser, or a logistics-capture
// question) rather than silently changing the computation later.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('exchange', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('thread_id').notNullable().references('id').inTable('topic_thread').onDelete('CASCADE');
    // 'user' | 'assistant'
    table.string('role', 20).notNullable();
    table.text('text').notNullable();
    table.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());
    // 'app' | 'email'
    table.string('channel', 20).notNullable();
    // Candidate-local calendar date, computed at write time — see utils/occasion.ts.
    table.date('occasion_id').notNullable();

    table.index(['thread_id']);
    table.index(['occasion_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('exchange');
}
