import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_BASE, AuthService } from './auth.service';

// login/refresh must never trigger another refresh (that would loop).
const isAuthEndpoint = (req: HttpRequest<unknown>) =>
  req.url === `${API_BASE}/auth/login` || req.url === `${API_BASE}/auth/refresh`;

const withToken = (req: HttpRequest<unknown>, token: string) =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

// Attaches the access token and, when the API answers 401 (the 15-minute
// access token expired), transparently refreshes once and retries the
// original request. If the refresh itself fails, the session is over:
// clear it and send the user to the login page.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (isAuthEndpoint(req) || !auth.token) return next(req);

  return next(withToken(req, auth.token)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.hasRefreshToken) {
        return throwError(() => err);
      }
      return auth.refreshAccessToken().pipe(
        switchMap((newToken) => next(withToken(req, newToken))),
        catchError((refreshErr) => {
          auth.clearSession();
          router.navigate(['/login']);
          return throwError(() => refreshErr);
        })
      );
    })
  );
};
