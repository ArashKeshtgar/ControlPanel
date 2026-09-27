import { HttpErrorResponse } from '@angular/common/http';
import { loginErrorMessage } from './login-page.component';

describe('loginErrorMessage', () => {
  const err = (status: number) => new HttpErrorResponse({ status });

  it('says the credentials are wrong only on a 401', () => {
    expect(loginErrorMessage(err(401))).toBe('Invalid username or password.');
  });

  it('says the server is unreachable when there is no response at all', () => {
    expect(loginErrorMessage(err(0))).toContain("Can't reach the server");
  });

  it('reports a server error as a server error', () => {
    expect(loginErrorMessage(err(500))).toContain('server error 500');
  });
});
