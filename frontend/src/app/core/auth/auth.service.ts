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

  devLogin(username: string, password: string): Observable<{ user: User }> {
    return this.api.post<{ user: User }>('/auth/dev-login', { username, password }).pipe(
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

  getProviders(): Observable<{ providers: string[]; inviteOnly: boolean }> {
    return this.api.get<{ providers: string[]; inviteOnly: boolean }>('/auth/providers');
  }
}
