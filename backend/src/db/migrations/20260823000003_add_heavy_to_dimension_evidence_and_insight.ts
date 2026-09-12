import type { Knex } from 'knex';

// Closes a residual guardrail gap (docs/personality-engine-implementation-plan.md, Iteration 8
// notes; spec §8: "even via RAG retrieval"). Iteration 8 tagged `heavy` (Q5/Q6/Q19/Q20 — the
// personality-engine questions never shown verbatim to a recruiter) onto the RAG-facing
// conversation_evidence/dimension_evidence-span chunks it wrote at write time, but never onto
// dimension_evidence itself — so nothing downstream (insight generation, profile_evidence) could
// tell a heavy-sourced span from any other. Backfilling both tables to `false` for existing rows
// is correct and safe: it only ever *widens* what's treated as heavy going forward (every row
// inserted after this migration carries a real value), it never narrows what Iteration 8 already
// restricted, and no existing row can retroactively become newly heavy in RAG results either way.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dimension_evidence', (table) => {
    table.boolean('heavy').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('insight', (table) => {
    // True if any of this insight's supporting_evidence_ids trace back to a heavy
    // dimension_evidence row — computed once at generation time (insight.service.ts), not
    // re-derived on every read.
    table.boolean('heavy').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('insight', (table) => {
    table.dropColumn('heavy');
  });
  await knex.schema.alterTable('dimension_evidence', (table) => {
    table.dropColumn('heavy');
  });
}
