import type { Knex } from 'knex';

// Employer-side onboarding, Phase 1 (docs/employer-onboarding-spec.md §2.1) — invite-only, per
// Michael's decision: an admin invites a specific email as a specific target role (today 'user'
// or 'employer') rather than a new login always landing as 'user'. `users.role` stays a plain
// string column (see the original role-column migration's own comment), so 'employer' needs no
// schema change there — this migration only adds the bit AdminService.inviteUser/upsertOidcUser
// need to remember *which* role a pending 'invited' row should become once claimed.
//
// Defaults to 'user' so every existing invited row (and every future plain-user invite) claims
// exactly as it did before this migration — additive, not a behavior change for the existing
// invite flow.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('invited_role', 20).notNullable().defaultTo('user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('invited_role');
  });
}
