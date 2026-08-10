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
}
