import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { API_BASE } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    localStorage.clear();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    localStorage.clear();
  });

  function signIn(access = 'access-1', refresh = 'refresh-1') {
    localStorage.setItem('cp_access_token', access);
    localStorage.setItem('cp_refresh_token', refresh);
  }

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('attaches the access token as a Bearer header', () => {
    signIn();
    http.get(`${API_BASE}/projects`).subscribe();

    const req = backend.expectOne(`${API_BASE}/projects`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    req.flush([]);
  });

  it('refreshes once on 401 and retries the original request with the new token', () => {
    signIn();
    let result: unknown;
    http.get(`${API_BASE}/projects`).subscribe((r) => (result = r));

    backend.expectOne(`${API_BASE}/projects`).flush(null, unauthorized);

    const refresh = backend.expectOne(`${API_BASE}/auth/refresh`);
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
    expect(refresh.request.headers.has('Authorization')).toBeFalse();
    refresh.flush({ accessToken: 'access-2', refreshToken: 'refresh-2' });

    const retry = backend.expectOne(`${API_BASE}/projects`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
    retry.flush(['ok']);

    expect(result).toEqual(['ok']);
    expect(localStorage.getItem('cp_refresh_token')).toBe('refresh-2');
  });

  it('shares one refresh call between requests that fail at the same time', () => {
    signIn();
    http.get(`${API_BASE}/projects`).subscribe();
    http.get(`${API_BASE}/projects/registry`).subscribe();

    backend.expectOne(`${API_BASE}/projects`).flush(null, unauthorized);
    backend.expectOne(`${API_BASE}/projects/registry`).flush(null, unauthorized);

    // expectOne fails if two refresh requests were sent.
    backend.expectOne(`${API_BASE}/auth/refresh`).flush({ accessToken: 'access-2', refreshToken: 'refresh-2' });

    const retries = backend.match((r) => r.headers.get('Authorization') === 'Bearer access-2');
    expect(retries.map((r) => r.request.url).sort()).toEqual([`${API_BASE}/projects`, `${API_BASE}/projects/registry`]);
    retries.forEach((r) => r.flush([]));
  });

  it('ends the session and goes to /login when the refresh token is rejected', () => {
    signIn();
    let failed = false;
    http.get(`${API_BASE}/projects`).subscribe({ error: () => (failed = true) });

    backend.expectOne(`${API_BASE}/projects`).flush(null, unauthorized);
    backend.expectOne(`${API_BASE}/auth/refresh`).flush(null, unauthorized);

    expect(failed).toBeTrue();
    expect(localStorage.getItem('cp_access_token')).toBeNull();
    expect(localStorage.getItem('cp_refresh_token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not try to refresh on a 403 (authenticated but not allowed)', () => {
    signIn();
    let status = 0;
    http.put(`${API_BASE}/projects/1`, {}).subscribe({ error: (e) => (status = e.status) });

    backend.expectOne(`${API_BASE}/projects/1`).flush(null, { status: 403, statusText: 'Forbidden' });

    expect(status).toBe(403);
    backend.expectNone(`${API_BASE}/auth/refresh`);
  });
});
