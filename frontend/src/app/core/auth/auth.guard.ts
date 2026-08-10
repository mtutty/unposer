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
