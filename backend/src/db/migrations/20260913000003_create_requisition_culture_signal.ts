import type { Knex } from 'knex';

// Employer-side onboarding, Phase 2 (docs/employer-onboarding-spec.md §4's CVF-quadrant decision,
// 2026-09-12). Shares the candidate side's CvfQuadrant vocabulary (hierarchy/adhocracy/clan/
// market — see culture_signal's migration) but is a deliberately separate table: culture_signal
// means "this candidate's *former* employer's culture, inferred indirectly from three story
// questions" — a different, lower-confidence provenance than an employer describing their own
// *current* team's culture directly. Conflating the two in one table would blend evidence
// qualities this codebase otherwise keeps apart (see the distilled/raw profile_evidence split).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('requisition_culture_signal', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('requisition_id').notNullable().references('id').inTable('job_requisitions').onDelete('CASCADE');
    // 'hierarchy' | 'adhocracy' | 'clan' | 'market'
    table.string('cvf_quadrant', 20).notNullable();
    table.jsonb('source_message_ids').notNullable().defaultTo('[]');
    table.timestamps(true, true);

    table.index(['requisition_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('requisition_culture_signal');
}
