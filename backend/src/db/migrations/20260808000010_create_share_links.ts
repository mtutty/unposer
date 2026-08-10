import type { Knex } from 'knex';

// Step 8: a time-boxed token pointing at the exact same chat+RAG experience as Step 7, backed
// live by the same approved profile. No per-recruiter visibility controls, no analytics, no
// revocation beyond natural expiry — v1 scope per spec.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('share_links', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token', 64).notNullable().unique();
    table.string('label', 255);
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['token']);
    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('share_links');
}
