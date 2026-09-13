import { db } from '../db/connection';
import { RemotePreference } from '../types';

// Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — "basic search on common
// commodity filters," deliberately no more than that: an ILIKE substring match on the candidate's
// own free-text target-role/location answers, plus an exact match on the normalized remote
// bucket (see utils/search-normalize.ts). No ranking/relevance model — same list+offset shape as
// AdminService.listUsers, and same "recruiter never sees raw evidence" posture as the personality
// spec's §8 guardrails: a result row is only the handful of fields below, nothing from
// profile_data itself.

export interface CandidateSearchFilters {
  /** Substring match against search_role (LogisticsData.targetRolesIndustries). */
  role?: string;
  /** Substring match against search_location (LogisticsData.locationPreference). */
  location?: string;
  remote?: Exclude<RemotePreference, null>;
  limit?: number;
  offset?: number;
}

export interface CandidateSearchResult {
  userId: string;
  headline: string;
  role: string | null;
  location: string | null;
  remote: RemotePreference;
}

export interface CandidateSearchResponse {
  results: CandidateSearchResult[];
  total: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export class CandidateSearchService {
  async search(filters: CandidateSearchFilters = {}): Promise<CandidateSearchResponse> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = filters.offset ?? 0;

    const scoped = () => {
      // discoverable=true and status='approved' both required — a candidate can only opt in
      // once their profile is approved (ShareService.assertShareEligible), but this is the read
      // path's own belt-and-suspenders check, not a substitute for that write-time gate.
      let query = db('candidate_profiles').where({ discoverable: true, status: 'approved' });
      if (filters.role) query = query.andWhereILike('search_role', `%${filters.role}%`);
      if (filters.location) query = query.andWhereILike('search_location', `%${filters.location}%`);
      if (filters.remote) query = query.andWhere({ search_remote: filters.remote });
      return query;
    };

    const [rows, countRow] = await Promise.all([
      scoped().orderBy('updated_at', 'desc').limit(limit).offset(offset),
      scoped().count('* as n').first()
    ]);

    const results: CandidateSearchResult[] = rows.map((row) => ({
      userId: row.user_id,
      headline: row.profile_data?.headline ?? '',
      role: row.search_role,
      location: row.search_location,
      remote: row.search_remote
    }));

    return { results, total: Number(countRow?.n ?? 0) };
  }
}
