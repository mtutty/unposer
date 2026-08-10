import type { Knex } from 'knex';

// Tracks where a candidate is in the 8-step onboarding flow (spec: docs/onboarding-ux-flow-spec.md).
// Server-driven UI: current_step + steps_state are the source of truth the frontend renders against.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('flow_progress', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.string('current_step', 50).notNullable();
    table.jsonb('steps_state').notNullable().defaultTo('{}');
    // 'app' | 'email' — which channel the candidate picked for the logistics step. Null until chosen.
    table.string('logistics_channel', 20);
    table.timestamps(true, true);

    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('flow_progress');
}
