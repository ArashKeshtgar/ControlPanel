import { HttpErrorResponse } from '@angular/common/http';
import { serviceErrorMessage } from './services-page.component';

describe('serviceErrorMessage', () => {
  const err = (status: number, message?: unknown) => new HttpErrorResponse({ status, error: message === undefined ? null : { message } });

  it('shows the API explanation when there is one', () => {
    expect(serviceErrorMessage(err(503, 'Service control is off: DOCKER_PROXY_URL is not set.'))).toContain('DOCKER_PROXY_URL');
    expect(serviceErrorMessage(err(400, ['a', 'b']))).toBe('a b');
  });

  it('explains a 403 as a missing Admin role and 0 as no connection', () => {
    expect(serviceErrorMessage(err(403))).toBe('Only an Admin can do that.');
    expect(serviceErrorMessage(err(0))).toContain("Can't reach");
  });

  it('falls back to the status code', () => {
    expect(serviceErrorMessage(err(502))).toBe('Request failed (HTTP 502).');
  });
});
