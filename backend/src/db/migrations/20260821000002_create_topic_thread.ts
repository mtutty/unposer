import type { Knex } from 'knex';

// Personality engine (docs/personality-analysis-engine-spec.md §5, tracked in
// docs/personality-engine-implementation-plan.md, Iteration 1 — scaffolding only, no
// chain/service logic wired up yet). The unit of work for the 11-dimension scoring model is the
// topic thread, not the session/step: a thread spans any number of exchanges across days and
// channels and stays open until closed by the user or the model (spec §3's topic-close criteria
// — not enforced until Iteration 3).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('topic_thread', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // Question-library id (e.g. 'Q0', 'Q23') or an ad hoc reask id — see the flow addendum's note
    // that Step 6's correction re-ask is modeled as an ad hoc topic_thread outside the fixed
    // library. No FK: the question library itself lives in code, not the DB, same as
    // flow-steps.ts's conversationStarters.
    table.string('question_id', 50).notNullable();
    table.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('closed_at');
    // 'user' | 'model' — null while open.
    table.string('closed_by', 20);
    // 'open' | 'closed'
    table.string('status', 20).notNullable().defaultTo('open');
    table.timestamps(true, true);

    table.index(['user_id']);
    table.index(['question_id']);
    table.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('topic_thread');
}
