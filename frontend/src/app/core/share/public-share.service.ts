import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface PublicProfileView {
  headline: string;
  expiresAt: string;
}

/** Unauthenticated recruiter-facing view — Step 8. No session cookie involved, gated by token only. */
@Injectable({
  providedIn: 'root'
})
export class PublicShareService {
  constructor(private http: HttpClient) {}

  getProfile(token: string) {
    return this.http.get<PublicProfileView>(`${environment.apiUrl}/public/share/${token}`);
  }

  sendMessage(token: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, question: string) {
    return this.http.post<{ reply: string }>(`${environment.apiUrl}/public/share/${token}/message`, {
      history,
      question
    });
  }
}
