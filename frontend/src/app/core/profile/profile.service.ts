import { Injectable, computed, signal } from '@angular/core';
import { finalize, tap } from 'rxjs';
import { ApiService } from '../api/api.service';
import { CandidateProfile } from '../../models/profile.model';
import { ProgressionSummary } from '../../models/personality.model';

/**
 * Holds the candidate's profile as shared, service-level state — same pattern as
 * FlowService.progress / AuthService.currentUser — rather than each consuming component keeping
 * its own copy. This matters specifically for `synthesizing`/`profile`: both
 * profile-review.component.ts and sandbox.component.ts can trigger a profile (re)synthesis
 * (`generate`/`applyCorrections`), and both need to see the same in-flight/result state regardless
 * of which page actually triggered it.
 */
@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  profile = signal<CandidateProfile | null>(null);
  // True for the duration of generate() or applyCorrections() — the two "resynthesize the whole
  // profile" calls, both roughly a minute long. flagInsight()/approve() are comparatively quick
  // and keep their own local per-button UI state in each component instead.
  synthesizing = signal(false);
  synthesisError = signal('');
  correctionsBanner = signal('');
  // Gaps surfaced by Step 7 sandbox flagging that haven't been folded into the profile yet — see
  // applyCorrections(). Read directly off the profile so it can never drift from the profile's own
  // openQuestions array.
  pendingCorrectionCount = computed(() => this.profile()?.profile_data.openQuestions.length ?? 0);

  // Personality engine (Iteration 5) — the persistent post-Sketch "answer one more question"
  // affordance and "based on one session so far" caveat (flow addendum §5) both read off this.
  // Not folded into `profile` itself: it can be meaningful before a profile exists at all (tier
  // just reached Sketch, candidate hasn't clicked "Generate my profile" yet).
  progression = signal<ProgressionSummary | null>(null);

  constructor(private api: ApiService) {}

  get() {
    return this.api.get<CandidateProfile | null>('/profile').pipe(tap((p) => this.profile.set(p)));
  }

  loadProgression() {
    return this.api.get<ProgressionSummary>('/profile/progression').pipe(tap((p) => this.progression.set(p)));
  }

  generate() {
    this.synthesizing.set(true);
    this.synthesisError.set('');
    this.correctionsBanner.set('');
    return this.api.post<CandidateProfile>('/profile/generate', {}).pipe(
      tap({
        next: (p) => this.profile.set(p),
        error: (err) => this.synthesisError.set(err.error?.error?.message || 'Could not generate a profile yet')
      }),
      finalize(() => this.synthesizing.set(false))
    );
  }

  flagInsight(insightId: string) {
    return this.api
      .post<{ profile: CandidateProfile; reaskQuestion: string; routedTo: string }>('/profile/insights/flag', {
        insightId
      })
      .pipe(tap((r) => this.profile.set(r.profile)));
  }

  approve() {
    return this.api
      .post<{ profile: CandidateProfile; progress: any }>('/profile/approve', {})
      .pipe(tap((r) => this.profile.set(r.profile)));
  }

  /**
   * Step 7 -> Step 6 feedback loop: regenerates the profile from every currently-flagged sandbox
   * gap at once. Reachable both from the sandbox chat (sandbox.component.ts) and from the profile
   * page's "Open questions from your practice interview" section (profile-review.component.ts) —
   * same action, same endpoint, wherever the candidate notices the open questions first. No
   * approval gate on the result — see ProfileService.applyGapCorrections (backend). Still returns
   * the Observable (rather than being fire-and-forget) so a caller can chain a follow-up — sandbox
   * uses this to know when to refetch its message history once flags are cleared server-side.
   */
  applyCorrections() {
    this.synthesizing.set(true);
    this.synthesisError.set('');
    this.correctionsBanner.set('');
    return this.api.post<{ profile: CandidateProfile; appliedCount: number }>('/profile/apply-corrections', {}).pipe(
      tap({
        next: ({ profile, appliedCount }) => {
          this.profile.set(profile);
          this.correctionsBanner.set(
            `Your profile has been updated with ${appliedCount} correction${appliedCount === 1 ? '' : 's'}.`
          );
        },
        error: (err) => this.synthesisError.set(err.error?.error?.message || 'Could not apply your corrections — try again.')
      }),
      finalize(() => this.synthesizing.set(false))
    );
  }
}
