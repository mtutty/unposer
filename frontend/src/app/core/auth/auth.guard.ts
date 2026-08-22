import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser()) {
    return true;
  }

  return auth.getCurrentUser().pipe(
    map(() => true),
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

// Inverse of authGuard, for the public splash route: an already-signed-in visitor hitting `/`
// goes straight to /dashboard instead of seeing marketing copy again.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser()) {
    return router.createUrlTree(['/dashboard']);
  }

  return auth.getCurrentUser().pipe(
    map(() => router.createUrlTree(['/dashboard'])),
    catchError(() => of(true))
  );
};
