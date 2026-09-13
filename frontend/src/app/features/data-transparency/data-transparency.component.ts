import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicNavComponent } from '../../shared/components/public-nav/public-nav.component';
import { DataTransparencyContentComponent } from './data-transparency-content.component';

// Public page — `/how-your-profile-works`, same "no guard, reachable signed-in or signed-out"
// posture as HowItWorksComponent (see that file's comment), because the whole point is
// transparency for people who haven't committed to an account yet, not just existing candidates.
// Reachable from PublicNavComponent's "How it Works" nav plus a link from the profile-review step
// once someone actually has insights to look at.
//
// Candidate-side only for now. The same questions apply to the employer requisition
// Q&A/culture-signal pipeline (see CLAUDE.md's "Employer-Side Onboarding" section), but that
// workstream is newer and less settled — writing its FAQ now would either be thin or get stale
// fast. Add an "Employer data & analysis" section here once that pipeline's shape has held still
// for a while, rather than trying to cover it today.
@Component({
  selector: 'app-data-transparency',
  imports: [RouterLink, PublicNavComponent, DataTransparencyContentComponent],
  template: `
    <div class="page">
      <app-public-nav />

      <section class="hero">
        <div class="hero-inner">
          <span class="eyebrow">Data & analysis</span>
          <h1>How your profile is built.</h1>
          <p class="lede">
            What we ask, what we do with it, what we deliberately withhold from recruiters, and
            where the real limits are — including the honest answer to "can someone game this."
          </p>
        </div>
      </section>

      <section class="container section">
        <img class="watermark" src="/unposer-trans.png" alt="" aria-hidden="true" />
        <app-data-transparency-content />
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
        position: relative;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        overflow-x: hidden;
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
        position: relative;
        padding: 3.5rem 1.5rem;
      }

      .watermark {
        position: absolute;
        top: 55%;
        left: -22rem;
        width: min(46rem, 75vw);
        max-width: none;
        transform: translateY(calc(-30% - 150px));
        opacity: 0.07;
        pointer-events: none;
        user-select: none;
        z-index: 0;
      }

      .section > app-data-transparency-content {
        position: relative;
        z-index: 1;
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
        flex-wrap: wrap;
        row-gap: 0.5rem;
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
export class DataTransparencyComponent {}
