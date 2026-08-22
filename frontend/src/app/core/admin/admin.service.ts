import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { User, UserRole, UserStatus } from '../../models/user.model';

export interface UserListFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export interface UserListResult {
  users: User[];
  total: number;
}

/** Admin/user-management API (backend/src/routes/admin.routes.ts) — every call requires the
 *  signed-in user to have role 'admin' server-side; this service has no client-side enforcement
 *  of its own beyond the adminGuard on the route that hosts it (see core/auth/auth.guard.ts). */
@Injectable({
  providedIn: 'root'
})
export class AdminService {
  constructor(private api: ApiService) {}

  listUsers(filters: UserListFilters = {}): Observable<UserListResult> {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.role) params.set('role', filters.role);
    if (filters.status) params.set('status', filters.status);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.api.get<UserListResult>(`/admin/users${qs ? `?${qs}` : ''}`);
  }

  updateUser(id: string, changes: { role?: UserRole; status?: UserStatus }): Observable<{ user: User }> {
    return this.api.patch<{ user: User }>(`/admin/users/${id}`, changes);
  }
}
