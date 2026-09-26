import { checkAdapterBaseUrl, DEFAULT_ALLOWED_ADAPTER_HOSTS, parseAllowedHosts } from './adapter-url';

describe('checkAdapterBaseUrl (SSRF allowlist)', () => {
  const allowed = ['localhost', 'hisplus-adapter'];

  it.each(['http://localhost:4003', 'https://localhost', 'http://hisplus-adapter:4002/'])('accepts %s', (url) => {
    expect(checkAdapterBaseUrl(url, allowed)).toBeNull();
  });

  it.each([
    ['a host outside the allowlist', 'http://169.254.169.254'],
    ['an internal host not on the list', 'http://sqlserver:1433'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'http://user:pass@localhost:4003'],
    ['a path', 'http://localhost:4003/admin'],
    ['a query string', 'http://localhost:4003?x=1'],
    ['a relative value', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(checkAdapterBaseUrl(url, allowed)).not.toBeNull();
  });

  it('falls back to the default allowlist when the env var is empty', () => {
    expect(parseAllowedHosts(undefined)).toEqual(DEFAULT_ALLOWED_ADAPTER_HOSTS);
    expect(parseAllowedHosts(' A-Host , b ')).toEqual(['a-host', 'b']);
  });
});
