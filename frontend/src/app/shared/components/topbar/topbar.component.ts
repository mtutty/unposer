import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
    selector: 'app-topbar',
    imports: [RouterLink],
    template: `
    <header class="topbar">
      <a [routerLink]="auth.currentUser()?.role === 'admin' ? '/admin/users' : '/dashboard'" class="brand font-display">
        <img class="brand-mark" src="/light/favicon-48x48.png" alt="" aria-hidden="true" />
        Unposer
      </a>
      @if (auth.currentUser(); as user) {
        <div class="user">
          <span class="identity">
            @if (user.avatar_url) {
              <img class="avatar" [src]="user.avatar_url" [alt]="user.name" />
            } @else {
              <svg class="avatar avatar-glyph" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4" fill="currentColor" />
                <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" />
              </svg>
            }
            <span class="meta">{{ user.name }}</span>
          </span>
          <button class="btn btn-ghost" (click)="logout()">Log out</button>
          @if (user.role === 'admin') {
            <a routerLink="/admin/users" class="btn btn-ghost">Admin</a>
          } @else {
            <a routerLink="/settings/schedule" class="btn btn-ghost">Check-in settings</a>
          }
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
        font-size: 1.365rem;
      }

      .brand-mark {
        object-fit: contain;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .user {
        display: flex;
        align-items: center;
        gap: 0.9em;
      }

      .identity {
        display: flex;
        align-items: center;
        gap: 0.5em;
      }

      .avatar {
        width: 1.6em;
        height: 1.6em;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }

      .avatar-glyph {
        color: var(--paper-text-soft);
        background: var(--cover-3);
        padding: 0.15em;
        box-sizing: border-box;
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
