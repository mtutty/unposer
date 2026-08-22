import type { Knex } from 'knex';

// Personality engine (spec §8, tracked in docs/personality-engine-implementation-plan.md
// Iteration 8). "Bias-control audit logging groundwork: log enough to eventually segment score
// distributions by voluntarily-provided demographic data — no audit report yet, just the
// logging." dimension_score itself already IS that groundwork for score distributions (append-
// only, user_id is the join key). This table covers the other half of §8's concrete, buildable-
// now surface: a record of every recruiter-facing evidence-retrieval query, so the §8
// verbatim-restriction guardrail (see evidence.service.ts's search()) is independently
// verifiable over time, not just "should be working" — did a query for a given candidate ever
// return restricted content, and how often did the filter actually have something to exclude.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('rag_audit_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // 'candidate' | 'recruiter' — see evidence.service.ts's search() audience parameter.
    table.string('audience', 20).notNullable();
    table.text('query').notNullable();
    table.integer('results_returned').notNullable();
    // How many otherwise-matching rows the §8 restricted-content filter excluded before
    // `results_returned` was even computed — zero for every 'candidate' query, since the filter
    // only applies to 'recruiter' ones.
    table.integer('results_excluded_restricted').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['user_id']);
    table.index(['audience']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('rag_audit_log');
}
