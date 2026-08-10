import type { Knex } from 'knex';

// Step 2: resume upload / manual entry. Parser output is never treated as ground truth until
// the candidate confirms it on the correction screen (confirmed / confirmed_at).
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('resumes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.string('file_path', 500);
    table.string('file_name', 255);
    table.string('mime_type', 100);
    table.text('raw_text');
    table.jsonb('structured_data');
    // Self-selected, per spec: simpler and more reliable than inferring from resume content.
    table.boolean('is_career_changer').notNullable().defaultTo(false);
    table.boolean('confirmed').notNullable().defaultTo(false);
    table.timestamp('confirmed_at');
    table.string('parse_status', 20).notNullable().defaultTo('pending');
    table.text('parse_error');
    table.timestamps(true, true);

    table.index(['user_id']);
    table.index(['parse_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('resumes');
}
