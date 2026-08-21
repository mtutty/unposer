import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

// Public marketing splash — the `/` route (guestGuard.ts sends already-signed-in visitors
// straight to /dashboard instead). Everything below is static content, no page-specific state.
@Component({
    selector: 'app-splash',
    imports: [RouterLink],
    template: `
    <div class="page">
      <header class="nav">
        <span class="brand font-display">
          <span class="brand-mark" aria-hidden="true">✦</span>
          Unposer
        </span>
        <a routerLink="/login" class="btn btn-on-cover">Sign in</a>
      </header>

      <section class="hero">
        <div class="hero-inner">
          <span class="stamp stamp-brass">v1 prototype</span>
          <h1>The real you.<br /><em>Unposed.</em></h1>
          <p class="lede">
            Most hiring starts with a performance — a resume polished for keyword scanners, an
            interview rehearsed until it's hollow. Unposer starts with a conversation instead, and
            builds a career profile that actually sounds like you.
          </p>
          <div class="hero-cta">
            <a routerLink="/login" class="btn btn-primary btn-lg">Get started</a>
            <span class="meta">No forced timer — go by chat or email, at your own pace.</span>
          </div>
        </div>
      </section>

      <section class="container section">
        <span class="eyebrow">How it works</span>
        <h2>Three conversations, not one form</h2>
        <div class="steps">
          <div class="card step">
            <span class="step-num font-display">01</span>
            <h3>Share your story</h3>
            <p>
              Upload your resume — or start from scratch if you're changing careers — then talk
              through your goals, target roles, and priorities on your own schedule.
            </p>
          </div>
          <div class="card step">
            <span class="step-num font-display">02</span>
            <h3>Go deeper</h3>
            <p>
              A few open-ended conversations surface what a bullet-point resume can't: the hard
              calls you made, the wins you're proud of, how you actually work with people.
            </p>
          </div>
          <div class="card step">
            <span class="step-num font-display">03</span>
            <h3>Review &amp; share</h3>
            <p>
              Approve an AI-built profile that cites your own words as evidence. Practice the
              pitch in a private sandbox, then share a link recruiters can actually talk to.
            </p>
          </div>
        </div>
      </section>

      <section class="values-band">
        <div class="container section">
          <span class="eyebrow">Why it's different</span>
          <h2>No posing required</h2>
          <div class="values">
            <div class="value">
              <h3>Your words, not keyword-stuffing</h3>
              <p>No score-chasing or resume-speak — just your real experience, told the way you'd tell it.</p>
            </div>
            <div class="value">
              <h3>You approve everything</h3>
              <p>Anything that reads wrong gets flagged and re-asked, never silently edited. Nothing publishes without your OK.</p>
            </div>
            <div class="value">
              <h3>A conversation, not a PDF</h3>
              <p>Recruiters get to ask follow-up questions and get real answers — grounded in what you actually said.</p>
            </div>
          </div>
        </div>
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
        padding: 3rem 1.5rem 4rem;
      }

      .hero-inner {
        max-width: 640px;
        margin: 0 auto;
        text-align: center;
        color: var(--paper-text);
      }

      .hero-inner .stamp {
        margin-bottom: 1.25rem;
      }

      .hero-inner h1 {
        color: var(--paper-text);
        font-size: clamp(2.1rem, 1.6rem + 2.2vw, 3.4rem);

        em {
          font-style: normal;
          color: var(--brass);
        }
      }

      .lede {
        color: var(--paper-text-soft);
        font-size: 1.1rem;
        max-width: 34em;
        margin: 1rem auto 0;
      }

      .hero-cta {
        margin-top: 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
      }

      .btn-lg {
        padding: 0.85em 2em;
        font-size: 1rem;
      }

      .hero-cta .meta {
        color: var(--paper-text-soft);
        font-size: 0.78rem;
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

      .steps {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1.25rem;
      }

      .step {
        padding: 1.5rem;
        position: relative;
      }

      .step-num {
        display: block;
        color: var(--brass-strong);
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        margin-bottom: 0.6em;
      }

      .step h3 {
        margin-bottom: 0.35em;
      }

      .step p {
        color: var(--ink-soft);
        margin: 0;
        font-size: 0.96rem;
      }

      .values-band {
        background: var(--page-2);
      }

      .values {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2rem;
      }

      .value h3 {
        font-size: 1.05rem;
        margin-bottom: 0.35em;
      }

      .value p {
        color: var(--ink-soft);
        margin: 0;
        font-size: 0.96rem;
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

      @media (max-width: 720px) {
        .steps,
        .values {
          grid-template-columns: 1fr;
        }
      }
    `
    ]
})
export class SplashComponent {}
