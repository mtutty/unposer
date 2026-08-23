import type { Knex } from 'knex';

// Invitation-only mode (added at Michael's direction). Adds a third role — 'invited' — sitting
// alongside the existing 'user'/'admin' strings (still a plain column, not a DB enum, per the
// comment on the role column in the previous migration). An invited row is a placeholder created
// by an admin (AdminService.inviteUser) before the person has ever signed in, so oidc_provider/
// oidc_subject must become nullable — they're only populated once the invited person actually
// authenticates for the first time (AuthService's OIDC upsert flips role 'invited' -> 'user' at
// that point; see auth.service.ts). Postgres treats NULL as distinct for the existing
// (oidc_provider, oidc_subject) unique constraint, so multiple pending invites coexist fine.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('oidc_provider', 50).nullable().alter();
    table.string('oidc_subject', 255).nullable().alter();

    // Who invited this row and when — purely informational (admin "browse invitations" list),
    // not used by any auth check. Nullable: unset for every non-invited user (self-registered or
    // dev-seeded), and stays set on an invited row even after it flips to role 'user' so the
    // admin list keeps showing who originally invited them.
    table.uuid('invited_by').references('id').inTable('users');
    table.timestamp('invited_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('invited_by');
    table.dropColumn('invited_at');
    table.string('oidc_provider', 50).notNullable().alter();
    table.string('oidc_subject', 255).notNullable().alter();
  });
}
