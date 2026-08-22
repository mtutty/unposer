import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Competing Values Framework quadrant
// signal (spec §7) — environmental/employer-culture data, deliberately kept separate from
// personality dimension scores: inferring a candidate's traits from their employer's culture
// would be a methodology error per the spec.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('culture_signal', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // 'hierarchy' | 'adhocracy' | 'clan' | 'market'
    table.string('cvf_quadrant', 20).notNullable();
    table.jsonb('source_evidence_ids').notNullable().defaultTo('[]');
    table.timestamps(true, true);

    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('culture_signal');
}
