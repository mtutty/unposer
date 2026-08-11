import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { CandidateProfile } from '../../models/profile.model';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  constructor(private api: ApiService) {}

  get() {
    return this.api.get<CandidateProfile | null>('/profile');
  }

  generate() {
    return this.api.post<CandidateProfile>('/profile/generate', {});
  }

  flagInsight(insightId: string) {
    return this.api.post<{ profile: CandidateProfile; reaskQuestion: string; routedTo: string }>(
      '/profile/insights/flag',
      { insightId }
    );
  }

  approve() {
    return this.api.post<{ profile: CandidateProfile; progress: any }>('/profile/approve', {});
  }

  /**
   * Step 7 -> Step 6 feedback loop: regenerates the profile from every currently-flagged sandbox
   * gap at once. Reachable both from the sandbox chat (sandbox.component.ts) and from the profile
   * page's "Open questions from your practice interview" section (profile-review.component.ts) —
   * same action, same endpoint, wherever the candidate notices the open questions first. No
   * approval gate on the result — see ProfileService.applyGapCorrections (backend).
   */
  applyCorrections() {
    return this.api.post<{ profile: CandidateProfile; appliedCount: number }>('/profile/apply-corrections', {});
  }
}
