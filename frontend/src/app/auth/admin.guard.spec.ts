import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { adminGuard } from './admin.guard';

describe('adminGuard', () => {
  let router: jasmine.SpyObj<Router>;

  const run = () =>
    TestBed.runInInjectionContext(() => adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

  beforeEach(() => {
    localStorage.clear();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), { provide: Router, useValue: router }] });
  });

  afterEach(() => localStorage.clear());

  function signInAs(role: 'Admin' | 'Viewer') {
    localStorage.setItem('cp_access_token', 'a');
    localStorage.setItem('cp_user', JSON.stringify({ id: 1, username: 'u', role }));
  }

  it('lets an Admin open the Manage ports page', () => {
    signInAs('Admin');
    expect(run()).toBeTrue();
  });

  it('sends a Viewer back to the dashboard', () => {
    signInAs('Viewer');
    expect(run()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('turns away an anonymous visitor', () => {
    expect(run()).toBeFalse();
  });
});
