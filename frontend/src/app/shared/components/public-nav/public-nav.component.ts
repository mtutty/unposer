import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Header for signed-out visitors — used on the login page (which now doubles as the marketing
 * splash, see app.routes.ts) and How it Works. Distinct from TopbarComponent, which is only ever
 * shown to a signed-in user and reads auth.currentUser().
 */
@Component({
  selector: 'app-public-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="nav">
      <a routerLink="/login" class="brand font-display">
        <img class="brand-mark" src="/light/favicon-48x48.png" alt="" aria-hidden="true" />
        Unposer
      </a>
      <nav class="links">
        <a routerLink="/how-it-works" routerLinkActive="active" class="link">How it Works</a>
        <a routerLink="/login" class="btn btn-on-cover">Sign in</a>
      </nav>
    </header>
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
        text-decoration: none;
        font-weight: 600;
        font-size: 1.365rem;
      }

      .brand-mark {
        object-fit: contain;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .links {
        display: flex;
        align-items: center;
        gap: 1.25rem;
      }

      .link {
        color: var(--paper-text-soft);
        text-decoration: none;
        font-size: 0.92rem;

        &:hover,
        &.active {
          color: var(--paper-text);
        }
      }
    `
  ]
})
export class PublicNavComponent {}
