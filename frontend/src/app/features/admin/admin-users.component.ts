import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { AdminService } from '../../core/admin/admin.service';
import { User, UserRole, UserStatus } from '../../models/user.model';

interface UserRow {
  user: User;
  role: UserRole;
  status: UserStatus;
  saving: boolean;
  error: string | null;
}

/**
 * Plain, utilitarian internal tool — deliberately not styled with the candidate-facing "notebook"
 * design system (see CLAUDE.md's Styling section): this page is never seen by a candidate, and
 * matching the product's own visual voice here would suggest it's part of the product surface
 * rather than an ops screen. Still reuses the shared .btn/.field/.card primitives from
 * styles.scss so it doesn't need its own component library.
 */
@Component({
  selector: 'app-admin-users',
  imports: [TopbarComponent, FormsModule, DatePipe],
  template: `
    <app-topbar />

    <div class="container page">
      <h1>Users</h1>
      <p class="lede">List, filter, and edit user accounts — role and status changes take effect immediately.</p>

      <div class="filters card">
        <div class="field">
          <label for="q">Search</label>
          <input id="q" type="text" [(ngModel)]="q" (ngModelChange)="reload()" placeholder="Name or email" />
        </div>
        <div class="field">
          <label for="role">Role</label>
          <select id="role" [(ngModel)]="roleFilter" (ngModelChange)="reload()">
            <option [ngValue]="undefined">Any</option>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" [(ngModel)]="statusFilter" (ngModelChange)="reload()">
            <option [ngValue]="undefined">Any</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </select>
        </div>
      </div>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }

      <table class="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.user.id) {
            <tr>
              <td>{{ row.user.name }}</td>
              <td>{{ row.user.email }}</td>
              <td>
                <select [(ngModel)]="row.role">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td>
                <select [(ngModel)]="row.status">
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </td>
              <td>{{ row.user.last_login_at ? (row.user.last_login_at | date: 'medium') : 'never' }}</td>
              <td>
                <button
                  class="btn btn-secondary"
                  [disabled]="row.saving || (row.role === row.user.role && row.status === row.user.status)"
                  (click)="save(row)"
                >
                  {{ row.saving ? 'Saving…' : 'Save' }}
                </button>
                @if (row.error) {
                  <span class="error">{{ row.error }}</span>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6">{{ loading() ? 'Loading…' : 'No users match these filters.' }}</td>
            </tr>
          }
        </tbody>
      </table>

      <p class="meta">{{ total() }} total</p>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .filters {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        margin: 1rem 0;
        flex-wrap: wrap;
      }

      .filters .field {
        min-width: 12rem;
      }

      .user-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-mono);
        font-size: 0.9rem;
      }

      .user-table th,
      .user-table td {
        text-align: left;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border);
      }

      .error {
        color: var(--brick-strong, #a33);
      }
    `
  ]
})
export class AdminUsersComponent implements OnInit {
  rows = signal<UserRow[]>([]);
  total = signal(0);
  loading = signal(false);
  loadError = signal<string | null>(null);

  q = '';
  roleFilter: UserRole | undefined = undefined;
  statusFilter: UserStatus | undefined = undefined;

  constructor(private admin: AdminService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.admin.listUsers({ q: this.q || undefined, role: this.roleFilter, status: this.statusFilter }).subscribe({
      next: (result) => {
        this.rows.set(result.users.map((user) => ({ user, role: user.role, status: user.status, saving: false, error: null })));
        this.total.set(result.total);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Failed to load users.');
        this.loading.set(false);
      }
    });
  }

  save(row: UserRow): void {
    row.saving = true;
    row.error = null;
    this.admin.updateUser(row.user.id, { role: row.role, status: row.status }).subscribe({
      next: ({ user }) => {
        row.user = user;
        row.role = user.role;
        row.status = user.status;
        row.saving = false;
      },
      error: (err) => {
        row.saving = false;
        row.error = err?.error?.message || 'Save failed.';
      }
    });
  }
}
