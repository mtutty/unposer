import { RemotePreference } from '../types';

/**
 * Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — a plain keyword read of the
 * candidate's own free-text `LogisticsData.locationPreference` answer, not an LLM call. "Basic"
 * candidate search only needs a coarse remote/hybrid/onsite bucket to filter on, and adding a new
 * AI chain to profile generation just for this would be disproportionate — see
 * profile.service.ts's synthesizeProfile for where this gets called on every (re)generation.
 * Checked in order (hybrid/onsite before remote) so "remote or hybrid" style answers land on the
 * more specific of the two rather than always winning on "remote" appearing first.
 */
export function parseRemotePreference(locationPreference: string | null | undefined): RemotePreference {
  if (!locationPreference) return null;
  const text = locationPreference.toLowerCase();

  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bon-?site\b|\bin-?office\b|\bin person\b|\bno remote\b/.test(text)) return 'onsite';
  if (/\bremote\b|\bwfh\b|\bwork from home\b|\bfully distributed\b/.test(text)) return 'remote';

  return null;
}
