import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable();
    table.string('name', 255).notNullable();
    table.text('avatar_url');
    table.string('oidc_provider', 50).notNullable();
    table.string('oidc_subject', 255).notNullable();
    table.timestamps(true, true);

    table.unique(['email']);
    table.unique(['oidc_provider', 'oidc_subject']);
    table.index(['oidc_provider', 'oidc_subject']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('users');
}
