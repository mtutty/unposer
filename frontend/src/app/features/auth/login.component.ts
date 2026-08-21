import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

// Friendly text for the ?error= codes auth.routes.ts's /google/callback redirects back with.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  oauth_state_mismatch: 'Your sign-in session expired — please try again.',
  oauth_failed: 'Google sign-in failed. Please try again, or use dev login below.'
};

@Component({
    selector: 'app-login',
    imports: [FormsModule],
    template: `
    <div class="screen">
      <div class="intro">
        <span class="stamp stamp-brass">v1 prototype</span>
        <h1>Beyond the Resume</h1>
        <p class="lede">
          A career profile built from your stories, not a form — goals and logistics on your
          schedule, live conversation for the parts that need it.
        </p>
      </div>

      <form class="card panel" (ngSubmit)="onSubmit()">
        <span class="eyebrow">Sign in</span>

        @if (error()) {
          <p class="error-line">{{ error() }}</p>
        }

        @if (providers().includes('google')) {
          <a class="btn btn-secondary" href="/api/auth/google">Continue with Google</a>
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

        <p class="meta hint">Dev login — any environment with DEV_AUTH_ENABLED accepts devuser / devpass.</p>
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

      .hint {
        text-align: center;
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
