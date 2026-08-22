import type { Knex } from 'knex';

// Personality engine (flow addendum §6, tracked in
// docs/personality-engine-implementation-plan.md Iteration 5). Step 6's flag→re-ask correction
// loop opens a topic_thread outside the fixed question library (question_id like
// 'reask-<insight-id>', not a real 'Q<n>') — see topic-conversation.service.ts's
// openAdHocTopic(). Such a thread has no LibraryQuestion.dimensionLoads to fall back on for
// dimension-scoring extraction, so the target dimension(s) — derived from the flagged insight's
// own supporting evidence — are stored here instead. Null for every ordinary library-question
// thread.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('topic_thread', (table) => {
    table.jsonb('ad_hoc_dimensions');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('topic_thread', (table) => {
    table.dropColumn('ad_hoc_dimensions');
  });
}
