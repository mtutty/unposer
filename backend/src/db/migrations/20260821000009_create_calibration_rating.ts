import type { Knex } from 'knex';

// Personality engine (see topic_thread's migration comment). Rating-workbench output (spec §5.5
// Function 1) — a human rater's blind score against either a single evidence span or a whole
// exchange ("evidence_id | answer_id" in the spec; there's no separate "answer" entity in this
// schema, so exchange stands in for it). Exactly one of evidence_id/exchange_id is expected to be
// set per row; not enforced at the DB level in this scaffolding iteration.
//
// rater_id is a free-form string, not a FK to users: outside raters (e.g. a paid I/O
// psychologist) are not expected to be OIDC-authenticated app users, and the real admin/rater
// account + access-control model is explicitly deferred to Iteration 4 (see the implementation
// plan's calibration-console access-control note).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('calibration_rating', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('evidence_id').references('id').inTable('dimension_evidence').onDelete('CASCADE');
    table.uuid('exchange_id').references('id').inTable('exchange').onDelete('CASCADE');
    table.string('rater_id', 100).notNullable();
    table.string('dimension', 50).notNullable();
    table.integer('human_score').notNullable();
    table.string('confidence', 20).notNullable();
    table.text('notes');
    table.timestamp('rated_at').notNullable().defaultTo(knex.fn.now());
    // Anchoring-exception flag — ratings taken non-blind are excluded from agreement statistics
    // (spec §5.5 Function 1). Must default false; blind-by-default is the whole point.
    table.boolean('saw_model_score').notNullable().defaultTo(false);

    table.index(['dimension']);
    table.index(['rater_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('calibration_rating');
}
