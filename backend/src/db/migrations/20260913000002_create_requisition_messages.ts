import type { Knex } from 'knex';

// Employer-side onboarding, Phase 2 (docs/employer-onboarding-spec.md §4). `requisition_id` is
// denormalized alongside `thread_id` — same shape as `messages.user_id`/`.step` sitting next to
// `messages.thread_id` — so history/knownData queries don't need a join through
// requisition_threads for the (today) one-thread-per-requisition case.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('requisition_messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('thread_id').notNullable().references('id').inTable('requisition_threads').onDelete('CASCADE');
    table.uuid('requisition_id').notNullable().references('id').inTable('job_requisitions').onDelete('CASCADE');
    // 'user' (the employer) | 'assistant'
    table.string('role', 20).notNullable();
    table.text('content').notNullable();
    // Fields the elicitation turn extracted this message (assistant turns only) — see
    // requisition-conversation.service.ts's deriveKnownData, which folds these back in as
    // "already known" context for the next turn (no dedicated structured table for this step,
    // unlike logistics_responses — nothing in the spec calls for one).
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['requisition_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('requisition_messages');
}
