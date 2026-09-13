import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { JobRequisition, RequisitionMessage, RequisitionThread } from '../../models/requisition.model';

/** Employer-side onboarding Phase 1 (backend/src/routes/requisitions.routes.ts) — every call
 *  requires the signed-in user to have role 'employer' server-side; this service has no
 *  client-side enforcement of its own beyond the employerGuard on the route that hosts it (see
 *  core/auth/auth.guard.ts). Owner-scoped throughout: an employer only ever sees their own
 *  requisitions. */
@Injectable({
  providedIn: 'root'
})
export class RequisitionService {
  constructor(private api: ApiService) {}

  list(): Observable<{ requisitions: JobRequisition[] }> {
    return this.api.get<{ requisitions: JobRequisition[] }>('/requisitions');
  }

  get(id: string): Observable<{ requisition: JobRequisition }> {
    return this.api.get<{ requisition: JobRequisition }>(`/requisitions/${id}`);
  }

  create(fields: { title: string; description: string; requirements?: string }): Observable<{ requisition: JobRequisition }> {
    return this.api.post<{ requisition: JobRequisition }>('/requisitions', fields);
  }

  /** Only a 'draft' requisition can be edited (server 400s otherwise — see RequisitionService.update). */
  update(
    id: string,
    changes: { title?: string; description?: string; requirements?: string }
  ): Observable<{ requisition: JobRequisition }> {
    return this.api.patch<{ requisition: JobRequisition }>(`/requisitions/${id}`, changes);
  }

  /** Phase 2 — org/situational/cultural Q&A (docs/employer-onboarding-spec.md §4). Opens/resumes
   *  the thread and returns its full history — used for the read-only transcript once the thread
   *  is complete; the live back-and-forth itself goes over WebSocket (RequisitionChatPanelComponent),
   *  not this REST call, per the spec's live-chat-only decision. */
  getQa(id: string): Observable<{ messages: RequisitionMessage[]; thread: RequisitionThread }> {
    return this.api.get<{ messages: RequisitionMessage[]; thread: RequisitionThread }>(`/requisitions/${id}/qa`);
  }
}
