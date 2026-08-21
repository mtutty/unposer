import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

// Friendly text for the ?error= codes auth.routes.ts's /<provider>/callback routes redirect
// back with — same codes regardless of which provider (see registerOidcRoutes there).
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  oauth_state_mismatch: 'Your sign-in session expired — please try again.',
  oauth_failed: 'Sign-in failed. Please try again.'
};

@Component({
    selector: 'app-login',
    imports: [FormsModule],
    template: `
    <div class="screen">
      <div class="intro">
        <span class="stamp stamp-brass">v1 prototype</span>
        <h1>Unposer</h1>
        <p class="lede">
          Welcome back. Sign in to pick up your career profile where you left off.
        </p>
      </div>

      <form class="card panel" (ngSubmit)="onSubmit()">
        <span class="eyebrow">Sign in</span>

        @if (error()) {
          <p class="error-line">{{ error() }}</p>
        }

        @if (providers().includes('google')) {
          <a class="btn btn-secondary" href="/api/auth/google">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </a>
        }
        @if (providers().includes('github')) {
          <a class="btn btn-secondary" href="/api/auth/github">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Continue with GitHub
          </a>
        }
        @if (providers().includes('google') || providers().includes('github')) {
          <p class="meta divider"><span>or</span></p>
        }

        <div class="field">
          <label for="username">Username</label>
          <input id="username" type="text" [(ngModel)]="username" name="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" [(ngModel)]="password" name="password" autocomplete="current-password" required />
        </div>

        <button type="submit" class="btn btn-primary" [disabled]="loading()">
          {{ loading() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .screen {
        min-height: 100%;
        display: grid;
        place-items: center;
        background: var(--cover);
        padding: 3rem 1.5rem;
      }

      .intro {
        max-width: 720px;
        text-align: center;
        color: var(--paper-text);
        margin-bottom: 2.5rem;

        h1 {
          color: var(--paper-text);
        }
      }

      .lede {
        color: var(--paper-text-soft);
        font-size: 1.05rem;
        max-width: 32em;
        margin: 0.75rem auto 0;
      }

      .panel {
        width: 100%;
        max-width: 360px;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .error-line {
        color: var(--brick-strong);
        font-size: 0.88rem;
        margin: 0;
      }

      .divider {
        display: flex;
        align-items: center;
        text-align: center;
        color: var(--paper-text-soft);
        margin: 0;

        &::before,
        &::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid var(--border);
        }

        span {
          padding: 0 0.75em;
        }
      }
    `
    ]
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  loading = signal(false);
  error = signal('');
  providers = signal<string[]>([]);

  constructor(private authService: AuthService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const errorCode = this.route.snapshot.queryParamMap.get('error');
    if (errorCode) {
      this.error.set(OAUTH_ERROR_MESSAGES[errorCode] || 'Sign-in failed.');
    }

    this.authService.getProviders().subscribe({
      next: (res) => this.providers.set(res.providers),
      error: () => {} // Google button just stays hidden — dev login still works either way.
    });
  }

  onSubmit(): void {
    this.loading.set(true);
    this.error.set('');

    this.authService.devLogin(this.username, this.password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(err.error?.error?.message || 'Sign-in failed');
        this.loading.set(false);
      }
    });
  }
}
