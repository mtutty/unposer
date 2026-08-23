import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';
import { User } from '../../models/user.model';

// Candidate-only routes (dashboard, onboarding/*, settings/schedule — every current use of this
// guard) are off-limits to admin accounts: they don't have a profile of their own to build, so an
// admin lands here only in transit (fresh login, a stale link) and is bounced straight to the
// admin console instead of ever rendering the candidate UI. Symmetric with adminGuard bouncing a
// non-admin away from /admin/*.
// A 'pending' account (invite-only self-registration awaiting admin approval — see
// upsertOidcUser in auth.service.ts) is bounced to the waiting page ahead of the admin/role
// check below: it has no role-appropriate home yet, since requireAuth blocks it server-side from
// every candidate-flow route the same way it blocks 'suspended'.
function redirectPending(user: User, router: Router): UrlTree | null {
  return user.status === 'pending' ? router.createUrlTree(['/pending']) : null;
}

function redirectAdmin(user: User, router: Router): true | UrlTree {
  return user.role === 'admin' ? router.createUrlTree(['/admin/users']) : true;
}

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const resolve = (user: User) => redirectPending(user, router) ?? redirectAdmin(user, router);

  const alreadyResolved = auth.currentUser();
  if (alreadyResolved) {
    return resolve(alreadyResolved);
  }

  return auth.getCurrentUser().pipe(
    map((response) => resolve(response.user)),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};

// Same session-resolution shape as authGuard, plus a role check — a signed-in non-admin hitting
// an admin route is bounced to /dashboard rather than /login, since they *are* authenticated,
// just not authorized. Client-side only; the real enforcement is requireAdmin server-side
// (backend/src/middleware/auth.ts) — this just avoids flashing an admin page before an API 403
// would have redirected anyway.
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const alreadyResolved = auth.currentUser();
  if (alreadyResolved) {
    return alreadyResolved.role === 'admin' ? true : router.createUrlTree(['/dashboard']);
  }

  return auth.getCurrentUser().pipe(
    map((response) => (response.user.role === 'admin' ? true : router.createUrlTree(['/dashboard']))),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};

// Inverse of authGuard, for the login page (which doubles as the public splash — see
// app.routes.ts): an already-signed-in visitor hitting /login goes straight to /dashboard
// instead of seeing the sign-in form again — or /admin/users for an admin, or /pending for a
// still-pending account, same split as authGuard above.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const homeFor = (user: User) =>
    router.createUrlTree([user.status === 'pending' ? '/pending' : user.role === 'admin' ? '/admin/users' : '/dashboard']);

  const alreadyResolved = auth.currentUser();
  if (alreadyResolved) {
    return homeFor(alreadyResolved);
  }

  return auth.getCurrentUser().pipe(
    map((response) => homeFor(response.user)),
    catchError(() => of(true))
  );
};

// Guards the waiting page itself: only a signed-in 'pending' account should see it. An
// already-approved/admin account is sent to its normal home; a signed-out visitor to /login.
export const pendingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const resolve = (user: User) =>
    user.status === 'pending' ? true : router.createUrlTree([user.role === 'admin' ? '/admin/users' : '/dashboard']);

  const alreadyResolved = auth.currentUser();
  if (alreadyResolved) {
    return resolve(alreadyResolved);
  }

  return auth.getCurrentUser().pipe(
    map((response) => resolve(response.user)),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};
