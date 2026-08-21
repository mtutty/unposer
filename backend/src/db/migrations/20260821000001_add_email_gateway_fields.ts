import type { Knex } from 'knex';

// Real Resend-backed email gateway (webhooks.routes.ts + email.service.ts): inbound routing and
// outbound threading need a couple of per-thread fields the simulated-in-app email channel never
// needed. See CLAUDE.md's "Email-gateway design intent" for the additive shape this follows.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversation_threads', (table) => {
    // Per-thread routing key. Every outbound email on this thread sets
    // `Reply-To: reply+<inbound_token>@<EMAIL_INBOUND_DOMAIN>`; the inbound webhook extracts the
    // token from the recipient address to find the thread without needing an authenticated
    // session (the webhook is server-to-server, not a browser request). Generated as a DB
    // default so every thread gets one for free, including app-only steps (unused there, harmless).
    table.uuid('inbound_token').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    // rfc822 Message-ID of the last inbound/outbound email on this thread, for In-Reply-To/
    // References threading headers so replies show up nested in the candidate's mail client.
    table.text('last_inbound_message_id');
    table.text('last_outbound_message_id');
  });

  // Generic idempotency guard for inbound webhooks — at-least-once delivery (Resend/Svix retry
  // on a non-2xx response) means the same event can arrive twice. Keyed by source so other
  // webhook providers could reuse this table later without a new one.
  await knex.schema.createTable('processed_webhook_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('source', 50).notNullable();
    table.string('external_id', 255).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['source', 'external_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('processed_webhook_events');
  await knex.schema.alterTable('conversation_threads', (table) => {
    table.dropColumn('inbound_token');
    table.dropColumn('last_inbound_message_id');
    table.dropColumn('last_outbound_message_id');
  });
}
