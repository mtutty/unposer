import { Injectable, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { User } from '../../models/user.model';
import { Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);
  isAuthenticated = signal<boolean>(false);

  constructor(private api: ApiService) {}

  /** No-password login bypass for local dev/QA — type any username or email, no password. See
   *  AuthService.testLogin on the backend. */
  testLogin(username: string): Observable<{ user: User }> {
    return this.api.post<{ user: User }>('/auth/test-login', { username }).pipe(
      tap(response => {
        this.currentUser.set(response.user);
        this.isAuthenticated.set(true);
      })
    );
  }

  getCurrentUser(): Observable<{ user: User }> {
    return this.api.get<{ user: User }>('/auth/me').pipe(
      tap(response => {
        this.currentUser.set(response.user);
        this.isAuthenticated.set(true);
      })
    );
  }

  logout(): Observable<any> {
    return this.api.post('/auth/logout', {}).pipe(
      tap(() => {
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
      })
    );
  }

  getProviders(): Observable<{ providers: string[]; inviteOnly: boolean; testLogin: boolean }> {
    return this.api.get<{ providers: string[]; inviteOnly: boolean; testLogin: boolean }>('/auth/providers');
  }

  /** Self-service cancel, offered from the "pending approval" waiting page — see
   *  PendingApprovalComponent and DELETE /api/auth/me. */
  deleteAccount(): Observable<void> {
    return this.api.delete<void>('/auth/me').pipe(
      tap(() => {
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
      })
    );
  }
}
