import type { Knex } from 'knex';

// Personality engine (Iteration 5 gap-fills found while building the tier engine — see
// docs/personality-engine-implementation-plan.md). Two columns dimension_score needed but didn't
// have:
//   - distinct_questions: sibling to the existing distinct_occasions — the "In depth" tier (spec
//     §3.5) is explicitly defined as "every dimension evidenced from ≥2 questions on ≥2 distinct
//     occasions," and there was nowhere to read the question-diversity half of that from without
//     re-querying dimension_evidence/topic_thread every time. scoring-aggregation.service.ts
//     already computed this value each recompute, just never persisted it.
//   - variance_pattern: the model's variance classification (spec §4.4/§9.9) for this dimension's
//     current evidence set — 'topic_linked' | 'occasion_linked' | 'monotonic_drift' | 'ambiguous'
//     | null (stable). Needed so the insight generator (Iteration 5, spec §6.4) can find
//     context-dependence-insight-eligible dimensions: topic_linked is deliberately never written
//     as a variance_flag row (see scoring-aggregation.service.ts's writeVarianceFlag), so without
//     this column that classification would be lost the moment the next recompute overwrote it.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dimension_score', (table) => {
    table.integer('distinct_questions').notNullable().defaultTo(0);
    table.string('variance_pattern', 20);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dimension_score', (table) => {
    table.dropColumn('distinct_questions');
    table.dropColumn('variance_pattern');
  });
}
