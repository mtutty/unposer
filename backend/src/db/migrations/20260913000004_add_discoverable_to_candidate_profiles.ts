import type { Knex } from 'knex';

// Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — opt-in discoverability plus
// the handful of normalized "commodity filter" fields search runs against. `discoverable`
// defaults false and is set only by the candidate's own explicit action (ShareService.setDiscoverable,
// surfaced from the Share step); nothing else in the app ever flips it. `search_role`/
// `search_location` are plain copies of the free-text LogisticsData fields a candidate already
// entered (`targetRolesIndustries`/`locationPreference`) — denormalized onto candidate_profiles so
// search can filter/index without joining logistics_responses or parsing profile_data's JSONB.
// `search_remote` is a light heuristic parse of locationPreference (see
// utils/search-normalize.ts) — 'remote' | 'hybrid' | 'onsite' | null, not LLM-derived; a plain
// keyword read is enough for "basic" search per the spec's own scoping, and avoids adding a new AI
// call to profile generation for this. All three are recomputed on every profile
// generation/regeneration (see profile.service.ts's synthesizeProfile) — `discoverable` is
// deliberately left out of that recompute so a candidate's own choice survives a profile refresh.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('candidate_profiles', (table) => {
    table.boolean('discoverable').notNullable().defaultTo(false);
    table.text('search_role');
    table.text('search_location');
    table.string('search_remote', 10);

    table.index(['discoverable']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('candidate_profiles', (table) => {
    table.dropColumn('discoverable');
    table.dropColumn('search_role');
    table.dropColumn('search_location');
    table.dropColumn('search_remote');
  });
}
