import { Component, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

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
        <a routerLink="/login" class="btn btn-on-cover" (click)="onSignIn($event)">Sign in</a>
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
        // Shown on every signed-out screen — brand + links can crowd a phone-width row. Wrap
        // rather than force the page wider (see TopbarComponent, same shape/fix).
        flex-wrap: wrap;
        row-gap: 0.5rem;
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
        flex-wrap: wrap;
        row-gap: 0.4em;
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
export class PublicNavComponent {
  constructor(private router: Router) {}

  /**
   * /login doubles as the marketing splash (see app.routes.ts) — its pitch copy is long enough to
   * push the actual sign-in panel below the fold on anything but a wide screen, so a plain
   * routerLink here would either no-op (already on /login — same-URL navigation is a no-op by
   * default) or land back at the top of a long page. Instead this always scrolls the panel
   * (#login-panel in login.component.ts) into view and focuses the username field once it's on
   * screen — immediately when already on /login, after the navigation resolves otherwise. Left-
   * click only: a modified click (ctrl/cmd/shift/middle-click, "open in new tab") is left alone so
   * the plain routerLink href still handles it normally.
   */
  onSignIn(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.router.navigateByUrl('/login').then(() => {
      // Deferred a frame so a freshly-navigated-to (or just-reordered-by-the-mobile-breakpoint)
      // panel has actually laid out before scrollIntoView measures it.
      requestAnimationFrame(() => {
        document.getElementById('login-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        (document.getElementById('username') as HTMLInputElement | null)?.focus({ preventScroll: true });
      });
    });
  }
}
