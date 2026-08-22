import type { Knex } from 'knex';

// Personality engine (spec §3.5 "Re-engagement cadence", tracked in
// docs/personality-engine-implementation-plan.md Iteration 9). `progression` already had
// `pace_preference`/`last_contact_at` from Iteration 1 — this adds the state the weekly
// scheduler actually needs to enforce pause/unsubscribe/dormancy. All nullable/zero-default so
// every existing row is simply "active, never paused, never missed a reply."
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('progression', (table) => {
    // Set together: paused_until for a 30/90-day pause, paused_indefinitely for "indefinitely" —
    // never both meaningfully set at once, but kept as two columns rather than one enum+date so
    // "resume" is always just "clear both," no branching on which kind of pause was active.
    table.timestamp('paused_until');
    table.boolean('paused_indefinitely').notNullable().defaultTo(false);
    // Separate from account/profile deletion (spec §3.5: "must be clearly separable") — this
    // user row, profile, and all evidence are untouched; only the weekly scheduler stops.
    table.timestamp('unsubscribed_at');
    // Consecutive weekly prompts sent with no reply before the next one came due. Reset to 0 the
    // moment any reply arrives; hits 4 -> dormant_at is set and no 5th prompt goes out.
    table.integer('unanswered_count').notNullable().defaultTo(0);
    table.timestamp('dormant_at');

    table.index(['unsubscribed_at']);
    table.index(['dormant_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('progression', (table) => {
    table.dropColumn('paused_until');
    table.dropColumn('paused_indefinitely');
    table.dropColumn('unsubscribed_at');
    table.dropColumn('unanswered_count');
    table.dropColumn('dormant_at');
  });
}
