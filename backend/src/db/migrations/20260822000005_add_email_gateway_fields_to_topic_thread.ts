import type { Knex } from 'knex';

// Personality engine (flow addendum §3, tracked in
// docs/personality-engine-implementation-plan.md Iteration 6). Mirrors the email-gateway columns
// conversation_threads already has (see 20260821000001_add_email_gateway_fields.ts) — Step 5's
// per-topic email channel needs the same real routing key + Resend threading state, per thread
// rather than per step, since a candidate may have any number of topic_threads over time and each
// one that goes to email needs its own `reply+<token>@` address.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('topic_thread', (table) => {
    table.uuid('inbound_token').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('last_inbound_message_id');
    table.text('last_outbound_message_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('topic_thread', (table) => {
    table.dropColumn('inbound_token');
    table.dropColumn('last_inbound_message_id');
    table.dropColumn('last_outbound_message_id');
  });
}
