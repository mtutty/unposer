import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { HowItWorksContentComponent } from '../how-it-works/how-it-works-content.component';

/**
 * Shown to a signed-in 'pending' account (invite-only self-registration awaiting admin
 * approval — see upsertOidcUser in auth.service.ts, and pendingGuard which routes here). Not
 * TopbarComponent: that assumes an approved role's own nav (Admin / Check-in settings), neither
 * of which applies yet.
 */
@Component({
  selector: 'app-pending-approval',
  imports: [HowItWorksContentComponent],
  template: `
    <header class="nav">
      <span class="brand font-display">
        <span class="brand-mark" aria-hidden="true">✦</span>
        Unposer
      </span>
      <button class="btn btn-on-cover" (click)="logout()">Log out</button>
    </header>

    <section class="hero">
      <div class="hero-inner">
        <span class="stamp stamp-brass">Pending approval</span>
        <h1>Thanks for signing up.</h1>
        <p class="lede">
          Unposer is invitation-only right now. Your account is created and waiting on an admin
          to approve it — we'll let you in as soon as that happens, no further action needed on
          your end.
        </p>

        @if (deleteError()) {
          <p class="error-line">{{ deleteError() }}</p>
        }

        @if (confirmingDelete()) {
          <div class="confirm-row">
            <span class="meta">Cancel your signup and delete this account? This can't be undone.</span>
            <div class="confirm-actions">
              <button class="btn btn-secondary" [disabled]="deleting()" (click)="confirmingDelete.set(false)">Never mind</button>
              <button class="btn btn-secondary danger" [disabled]="deleting()" (click)="deleteAccount()">
                {{ deleting() ? 'Deleting…' : 'Yes, delete my account' }}
              </button>
            </div>
          </div>
        } @else {
          <button class="btn-link" (click)="confirmingDelete.set(true)">Changed your mind? Cancel and delete this account</button>
        }
      </div>
    </section>

    <section class="container section">
      <span class="eyebrow">While you wait</span>
      <h2>Here's how Unposer works</h2>
      <app-how-it-works-content />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.5rem;
        background: var(--cover);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.5em;
        color: var(--paper-text);
        font-weight: 600;
        font-size: 1.05rem;
      }

      .brand-mark {
        color: var(--brass);
      }

      .hero {
        background: linear-gradient(180deg, var(--cover) 0%, var(--cover-2) 100%);
        padding: 3rem 1.5rem 3.5rem;
      }

      .hero-inner {
        max-width: 620px;
        margin: 0 auto;
        text-align: center;
        color: var(--paper-text);
      }

      .hero-inner .stamp {
        margin-bottom: 1.1rem;
      }

      .hero-inner h1 {
        color: var(--paper-text);
        margin-top: 0.3em;
      }

      .lede {
        color: var(--paper-text-soft);
        font-size: 1.05rem;
        max-width: 32em;
        margin: 1rem auto 0;
      }

      .error-line {
        color: var(--brick-strong, #a33);
        font-size: 0.88rem;
        margin: 1rem 0 0;
      }

      .btn-link {
        background: none;
        border: none;
        color: var(--paper-text-soft);
        text-decoration: underline;
        cursor: pointer;
        font-size: 0.85rem;
        margin-top: 1.75rem;
        padding: 0;

        &:hover {
          color: var(--paper-text);
        }
      }

      .confirm-row {
        margin-top: 1.75rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
      }

      .confirm-row .meta {
        color: var(--paper-text-soft);
        font-size: 0.85rem;
      }

      .confirm-actions {
        display: flex;
        gap: 0.75rem;
      }

      .btn.danger {
        border-color: var(--brick-strong, #a33);
        color: var(--brick-strong, #a33);
      }

      .section {
        padding: 3.5rem 1.5rem;
      }

      .section > .eyebrow {
        text-align: center;
      }

      .section > h2 {
        text-align: center;
        max-width: 26em;
        margin: 0 auto 2.25rem;
      }
    `
  ]
})
export class PendingApprovalComponent {
  confirmingDelete = signal(false);
  deleting = signal(false);
  deleteError = signal<string | null>(null);

  constructor(private auth: AuthService, private router: Router) {}

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  deleteAccount(): void {
    this.deleting.set(true);
    this.deleteError.set(null);
    this.auth.deleteAccount().subscribe({
      next: () => this.router.navigate(['/login']),
      error: (err) => {
        this.deleting.set(false);
        this.deleteError.set(err?.error?.error?.message || 'Failed to delete account.');
      }
    });
  }
}
