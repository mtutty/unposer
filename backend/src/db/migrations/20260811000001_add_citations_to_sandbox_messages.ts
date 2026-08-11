import type { Knex } from 'knex';

// Step 7's "why did it say that" affordance: an assistant reply can carry a short list of which
// profile facts (a STAR story, an insight, a job) grounded it, shown as an expandable disclosure
// next to the reply so the candidate can judge — and correct via "This doesn't sound right" —
// with the actual evidence in view rather than guessing. Nullable/JSONB: only assistant messages
// get one, and only once the identify-citations follow-up call resolves (see sandbox.routes.ts).
export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sandbox_messages', (table) => {
    table.jsonb('citations');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sandbox_messages', (table) => {
    table.dropColumn('citations');
  });
}
