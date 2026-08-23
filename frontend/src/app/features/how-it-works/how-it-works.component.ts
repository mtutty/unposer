import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicNavComponent } from '../../shared/components/public-nav/public-nav.component';
import { HowItWorksContentComponent } from './how-it-works-content.component';

// Public page — the `/how-it-works` route, linked from PublicNavComponent for signed-out
// visitors (see app.routes.ts). No guard: reachable whether signed in or not, same as the old
// splash page was.
@Component({
  selector: 'app-how-it-works',
  imports: [RouterLink, PublicNavComponent, HowItWorksContentComponent],
  template: `
    <div class="page">
      <app-public-nav />

      <section class="hero">
        <div class="hero-inner">
          <span class="eyebrow">How it works</span>
          <h1>Five conversations, one real profile.</h1>
          <p class="lede">
            No forms, no multiple choice. Unposer builds your profile the way a good interviewer
            would — through actual conversation, on your schedule, with you in control of every
            correction.
          </p>
        </div>
      </section>

      <section class="container section">
        <app-how-it-works-content />
      </section>

      <footer class="footer">
        <div class="container footer-inner">
          <span class="brand font-display">
            <span class="brand-mark" aria-hidden="true">✦</span>
            Unposer
          </span>
          <a routerLink="/login" class="btn btn-on-cover">Sign in</a>
        </div>
      </footer>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page {
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }

      .hero {
        background: linear-gradient(180deg, var(--cover) 0%, var(--cover-2) 100%);
        padding: 3rem 1.5rem 3.5rem;
      }

      .hero-inner {
        max-width: 640px;
        margin: 0 auto;
        text-align: center;
        color: var(--paper-text);
      }

      .hero-inner .eyebrow {
        color: var(--brass);
      }

      .hero-inner h1 {
        color: var(--paper-text);
        font-size: clamp(2rem, 1.6rem + 1.8vw, 2.9rem);
        margin-top: 0.4em;
      }

      .lede {
        color: var(--paper-text-soft);
        font-size: 1.05rem;
        max-width: 34em;
        margin: 1rem auto 0;
      }

      .section {
        padding: 3.5rem 1.5rem;
      }

      .footer {
        margin-top: auto;
        background: var(--cover);
        padding: 1.5rem;
      }

      .footer-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
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
    `
  ]
})
export class HowItWorksComponent {}
