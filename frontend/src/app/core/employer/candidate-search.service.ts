import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';

export type RemotePreference = 'remote' | 'hybrid' | 'onsite';

export interface CandidateSearchFilters {
  role?: string;
  location?: string;
  remote?: RemotePreference;
  limit?: number;
  offset?: number;
}

export interface CandidateSearchResult {
  userId: string;
  headline: string;
  role: string | null;
  location: string | null;
  remote: RemotePreference | null;
}

export interface CandidateSearchResponse {
  results: CandidateSearchResult[];
  total: number;
}

/** Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — every call requires the
 *  signed-in user to have role 'employer' server-side, same posture as RequisitionService. */
@Injectable({
  providedIn: 'root'
})
export class CandidateSearchService {
  constructor(private api: ApiService) {}

  search(filters: CandidateSearchFilters): Observable<CandidateSearchResponse> {
    const params = new URLSearchParams();
    if (filters.role) params.set('role', filters.role);
    if (filters.location) params.set('location', filters.location);
    if (filters.remote) params.set('remote', filters.remote);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const query = params.toString();
    return this.api.get<CandidateSearchResponse>(`/employer/search${query ? `?${query}` : ''}`);
  }
}
