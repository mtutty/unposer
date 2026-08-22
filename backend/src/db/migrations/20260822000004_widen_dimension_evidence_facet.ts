import type { Knex } from 'knex';

// Bug found via Iteration 5's live-simulation verification (see
// docs/personality-engine-implementation-plan.md): dimension_evidence.facet was varchar(50), but
// the model doesn't always stay within DIMENSION_CONFIGS' facet vocabulary (dimension-
// scoring.chain.ts's FACETS list is a *suggestion* in the prompt, not a hard constraint on the
// schema) — a longer descriptive facet string 400'd the whole batch insert for that exchange
// ("value too long for type character varying(50)"), silently losing every evidence row in that
// batch, not just the offending one. Widened to text, matching span/note (both already
// unbounded) — nothing about facet tagging (spec §9.1) needs a length cap.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dimension_evidence', (table) => {
    table.text('facet').alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dimension_evidence', (table) => {
    table.string('facet', 50).alter();
  });
}
