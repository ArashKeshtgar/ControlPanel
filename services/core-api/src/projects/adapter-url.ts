// core-api fetches `${adapterBaseUrl}/status` for every registered project,
// so the registry is effectively a list of URLs the server will request.
// Without a check, anyone with the Admin role could point a row at an
// arbitrary internal address (cloud metadata endpoint, another service's
// admin port, ...) and have core-api request it — classic SSRF. Only plain
// http(s) base URLs on an explicit host allowlist are accepted.
export const DEFAULT_ALLOWED_ADAPTER_HOSTS = [
  'localhost',
  '127.0.0.1',
  'host.docker.internal',
  'wutility-adapter',
  'hisplus-adapter',
];

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return DEFAULT_ALLOWED_ADAPTER_HOSTS;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

// Returns null when the URL is acceptable, otherwise a human-readable reason.
export function checkAdapterBaseUrl(value: string, allowedHosts: string[]): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'adapterBaseUrl must be an absolute URL, e.g. http://localhost:4003';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'adapterBaseUrl must use http or https.';
  }
  if (url.username || url.password) {
    return 'adapterBaseUrl must not contain credentials.';
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return 'adapterBaseUrl must be a base URL only (scheme, host and port) — /status is appended automatically.';
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    return `Host '${url.hostname}' is not in ADAPTER_ALLOWED_HOSTS (${allowedHosts.join(', ')}).`;
  }
  return null;
}
