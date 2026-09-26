import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; role: 'Admin' | 'Viewer' };
}

const API_BASE = 'http://localhost:4000';
const TOKEN_KEY = 'cp_access_token';
const USER_KEY = 'cp_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE}/auth/login`, { username, password }).pipe(
      tap((res) => {
        localStorage.setItem(TOKEN_KEY, res.accessToken);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      })
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get currentUser(): LoginResponse['user'] | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}
