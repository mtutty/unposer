import type { Knex } from 'knex';

// Admin/user-management foundation (tracked as part of Iteration 4 in
// docs/personality-engine-implementation-plan.md — added at Michael's direction as prerequisite
// infrastructure for the personality engine's calibration console, whose actual build is
// deferred; see docs/calibration-console-spec.md). Every existing user defaults to role='user',
// status='active' so nothing about current auth/session behavior changes on deploy.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    // 'user' | 'admin' — extensible (e.g. a future 'rater' role for the calibration console,
    // see the spec doc) without a schema change, since it's a plain string, not a DB enum.
    table.string('role', 20).notNullable().defaultTo('user');
    // 'active' | 'suspended' — a suspended user is rejected at requireAuth (see middleware/auth.ts),
    // not just blocked from admin routes, so this actually does something app-wide.
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('last_login_at');

    table.index(['role']);
    table.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('role');
    table.dropColumn('status');
    table.dropColumn('last_login_at');
  });
}
