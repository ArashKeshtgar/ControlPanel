import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; role: 'Admin' | 'Viewer' };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const API_BASE = 'http://localhost:4000';
const TOKEN_KEY = 'cp_access_token';
const REFRESH_KEY = 'cp_refresh_token';
const USER_KEY = 'cp_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  // One in-flight refresh shared by every request that hit a 401 at the same
  // time — the server rotates refresh tokens, so parallel refreshes with the
  // same token would race each other.
  private refreshInFlight: Observable<string> | null = null;

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE}/auth/login`, { username, password }).pipe(
      tap((res) => {
        this.storeTokens(res);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      })
    );
  }

  // Exchanges the stored refresh token for a new pair and emits the new
  // access token. Errors (expired/revoked refresh token) clear the session.
  refreshAccessToken(): Observable<string> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw new Error('No refresh token stored.');

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.http.post<TokenPair>(`${API_BASE}/auth/refresh`, { refreshToken }).pipe(
        tap((pair) => this.storeTokens(pair)),
        map((pair) => pair.accessToken),
        catchError((err) => {
          this.clearSession();
          throw err;
        }),
        finalize(() => (this.refreshInFlight = null)),
        shareReplay(1)
      );
    }
    return this.refreshInFlight;
  }

  // Revokes the refresh tokens server-side, then clears local state. The
  // local session is cleared even if the server call fails, so "log out"
  // never leaves the user logged in on this device.
  logout(): Observable<void> {
    if (!this.token) {
      this.clearSession();
      return of(undefined);
    }
    return this.http.post<void>(`${API_BASE}/auth/logout`, {}).pipe(
      catchError(() => of(undefined)),
      map(() => undefined),
      finalize(() => this.clearSession())
    );
  }

  clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get hasRefreshToken(): boolean {
    return !!localStorage.getItem(REFRESH_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get currentUser(): LoginResponse['user'] | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  private storeTokens(pair: TokenPair): void {
    localStorage.setItem(TOKEN_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  }
}
