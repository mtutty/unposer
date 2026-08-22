import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
    selector: 'app-topbar',
    imports: [RouterLink],
    template: `
    <header class="topbar">
      <a routerLink="/dashboard" class="brand font-display">
        <span class="brand-mark" aria-hidden="true">✦</span>
        Unposer
      </a>
      @if (auth.currentUser(); as user) {
        <div class="user">
          @if (user.role === 'admin') {
            <a routerLink="/admin/users" class="btn btn-ghost">Admin</a>
          }
          <a routerLink="/settings/schedule" class="btn btn-ghost">Check-in settings</a>
          <span class="meta">{{ user.name }}</span>
          <button class="btn btn-ghost" (click)="logout()">Sign out</button>
        </div>
      }
    </header>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.5rem;
        background: var(--cover);
        color: var(--paper-text);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.5em;
        color: var(--paper-text);
        text-decoration: none;
        font-weight: 600;
        font-size: 1.05rem;
      }

      .brand-mark {
        color: var(--brass);
      }

      .user {
        display: flex;
        align-items: center;
        gap: 0.9em;
      }

      .user .meta {
        color: var(--paper-text-soft);
      }

      .user .btn-ghost {
        color: var(--paper-text-soft);
      }

      .user .btn-ghost:hover {
        color: var(--paper-text);
      }
    `
    ]
})
export class TopbarComponent {
  constructor(public auth: AuthService, private router: Router) {}

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }
}
