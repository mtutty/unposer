import type { Knex } from 'knex';

// Mirrors logistics_channel — persisted channel preference for the deep_prompts step (see
// docs/deep-prompts-email-channel-gap-assessment.md).
export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('flow_progress', (table) => {
    // 'app' | 'email' — which channel the candidate picked for the deep_prompts step. Null until chosen.
    table.string('deep_prompts_channel', 20);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('flow_progress', (table) => {
    table.dropColumn('deep_prompts_channel');
  });
}
