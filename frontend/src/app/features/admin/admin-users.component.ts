import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  imports: [TopbarComponent, FormsModule, DatePipe, RouterLink],
  template: `
    <app-topbar />

    <div class="container page">
      <h1>Users</h1>
      <p class="lede">List, filter, and edit user accounts — role and status changes take effect immediately.</p>

      <form class="invite-form card" (ngSubmit)="sendInvite()">
        <span class="eyebrow">Invite a user</span>
        <div class="invite-fields">
          <div class="field">
            <label for="invite-email">Email</label>
            <input id="invite-email" type="email" [(ngModel)]="inviteEmail" name="inviteEmail" required />
          </div>
          <div class="field invite-message-field">
            <label for="invite-message">Message (optional)</label>
            <input id="invite-message" type="text" [(ngModel)]="inviteMessage" name="inviteMessage" placeholder="Included in the invite email" />
          </div>
          <button type="submit" class="btn btn-primary" [disabled]="inviting() || !inviteEmail">
            {{ inviting() ? 'Sending…' : 'Send invite' }}
          </button>
        </div>
        @if (inviteError()) {
          <p class="error">{{ inviteError() }}</p>
        }
      </form>

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
            <option value="invited">invited</option>
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
              @if (row.user.role === 'invited') {
                <td>—</td>
                <td>{{ row.user.email }}</td>
                <td><span class="stamp stamp-brick">invited</span></td>
                <td>—</td>
                <td>{{ row.user.invited_at ? 'invited ' + (row.user.invited_at | date: 'medium') : 'pending' }}</td>
                <td>
                  <button class="btn btn-secondary" [disabled]="row.saving" (click)="revoke(row)">
                    {{ row.saving ? 'Revoking…' : 'Revoke' }}
                  </button>
                  @if (row.error) {
                    <span class="error">{{ row.error }}</span>
                  }
                </td>
              } @else {
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
                  <a class="btn btn-secondary" [routerLink]="['/admin/users', row.user.id]">View</a>
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
              }
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
      .invite-form {
        padding: 1rem;
        margin: 1rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .invite-fields {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: flex-end;
      }

      .invite-message-field {
        flex: 1;
        min-width: 16rem;
      }

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

      .user-table td:last-child {
        display: flex;
        align-items: center;
        gap: 0.5rem;
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

  inviteEmail = '';
  inviteMessage = '';
  inviting = signal(false);
  inviteError = signal<string | null>(null);

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

  sendInvite(): void {
    if (!this.inviteEmail) return;
    this.inviting.set(true);
    this.inviteError.set(null);
    this.admin.inviteUser(this.inviteEmail, this.inviteMessage || undefined).subscribe({
      next: () => {
        this.inviteEmail = '';
        this.inviteMessage = '';
        this.inviting.set(false);
        this.reload();
      },
      error: (err) => {
        this.inviting.set(false);
        this.inviteError.set(err?.error?.error?.message || 'Failed to send invite.');
      }
    });
  }

  revoke(row: UserRow): void {
    row.saving = true;
    row.error = null;
    this.admin.revokeInvite(row.user.id).subscribe({
      next: () => this.reload(),
      error: (err) => {
        row.saving = false;
        row.error = err?.error?.error?.message || 'Failed to revoke invite.';
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
        row.error = err?.error?.error?.message || 'Save failed.';
      }
    });
  }
}
