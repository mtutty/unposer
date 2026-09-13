import type { Knex } from 'knex';

// Employer-side onboarding, Phase 1 (docs/employer-onboarding-spec.md §3) — a job requisition
// owned by one employer user, no company/org entity (see spec §2.1's "no orgs, no seats" note).
// `requirements` is free text for v1; structured requirement fields are a later refinement once
// real usage shows what's needed (spec's own words). `status` starts 'draft' and only becomes
// 'active' once Phase 2's org/situational/cultural Q&A completes — mirroring resumes.confirmed's
// gate pattern (a resume isn't ground truth until confirmed; a req isn't real until its context
// is captured). Phase 2 isn't built yet, so nothing flips a requisition to 'active' today —
// 'closed' likewise unused until an employer-facing action exists to set it.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('job_requisitions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('title').notNullable();
    table.text('description').notNullable();
    table.text('requirements');
    table.string('status', 20).notNullable().defaultTo('draft');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('job_requisitions');
}
