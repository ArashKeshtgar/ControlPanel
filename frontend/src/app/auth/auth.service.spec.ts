import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE, AuthService } from './auth.service';

describe('AuthService', () => {
  let auth: AuthService;
  let backend: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    localStorage.clear();
  });

  it('stores both tokens and the user on login', () => {
    auth.login('admin', 'secret-password').subscribe();

    backend.expectOne(`${API_BASE}/auth/login`).flush({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 1, username: 'admin', role: 'Admin' },
    });

    expect(auth.token).toBe('a');
    expect(auth.hasRefreshToken).toBeTrue();
    expect(auth.currentUser?.role).toBe('Admin');
  });

  it('revokes server-side on logout and clears the session', () => {
    localStorage.setItem('cp_access_token', 'a');
    localStorage.setItem('cp_refresh_token', 'r');
    let done = false;

    auth.logout().subscribe({ complete: () => (done = true) });
    backend.expectOne(`${API_BASE}/auth/logout`).flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBeTrue();
    expect(auth.isLoggedIn).toBeFalse();
    expect(auth.hasRefreshToken).toBeFalse();
  });

  it('still clears the local session when the logout call fails', () => {
    localStorage.setItem('cp_access_token', 'a');
    localStorage.setItem('cp_refresh_token', 'r');
    let done = false;

    auth.logout().subscribe({ complete: () => (done = true) });
    backend.expectOne(`${API_BASE}/auth/logout`).error(new ProgressEvent('network down'));

    expect(done).toBeTrue();
    expect(auth.isLoggedIn).toBeFalse();
  });
});
