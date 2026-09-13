import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { ShareLink } from '../../models/sandbox.model';

@Injectable({
  providedIn: 'root'
})
export class ShareService {
  constructor(private api: ApiService) {}

  list() {
    return this.api.get<ShareLink[]>('/share');
  }

  create(days?: number, label?: string) {
    return this.api.post<{ link: ShareLink; url: string; progress: any }>('/share', { days, label });
  }

  /** Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — the candidate's own
   *  opt-in flag, alongside the share-link controls above. */
  getDiscoverable() {
    return this.api.get<{ discoverable: boolean }>('/share/discoverable');
  }

  setDiscoverable(discoverable: boolean) {
    return this.api.patch<{ discoverable: boolean }>('/share/discoverable', { discoverable });
  }
}
