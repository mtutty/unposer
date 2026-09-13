import type { Knex } from 'knex';

// Employer-side onboarding, Phase 2 (docs/employer-onboarding-spec.md §4) — one thread per
// requisition, not per (user, step) the way conversation_threads is keyed: a requisition's Q&A
// doesn't repeat across multiple steps the way a candidate's onboarding does. Always app-channel
// (spec §2.2's live-chat-only decision) — no `channel` column, no email-gateway bookkeeping
// fields conversation_threads carries for that reason, no `thread_cap` either (the 5-20 minute
// target is a prompt-level completion criterion, not a hard message-count cap).
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('requisition_threads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('requisition_id').notNullable().references('id').inTable('job_requisitions').onDelete('CASCADE').unique();
    // 'active' | 'complete'
    table.string('status', 20).notNullable().defaultTo('active');
    table.integer('message_count').notNullable().defaultTo(0);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('requisition_threads');
}
