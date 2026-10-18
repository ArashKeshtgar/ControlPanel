import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, parseProbes, ProbeAdapterOptions } from './app';

// Real Express app on an ephemeral port; only the probed apps are faked.
async function getStatus(options: Partial<ProbeAdapterOptions>) {
  const app = createApp({
    appName: 'ReBiomed',
    probes: [
      { name: 'web', url: 'http://rebiomed-web/' },
      { name: 'api', url: 'http://rebiomed-api:5000/api/categories' },
    ],
    ...options,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    return (await response.json()) as Record<string, unknown>;
  } finally {
    server.close();
  }
}

describe('probe-adapter /status', () => {
  it('is healthy when every probe answers 2xx, with each answer time', async () => {
    // Each call to the clock moves it 10 ms on, so every probe takes 10 ms.
    let t = 0;
    const now = () => (t += 10);
    const fetchImpl = jest.fn(async () => new Response('ok'));

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch, now });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ healthy: true, metrics: { webMs: expect.any(Number), apiMs: expect.any(Number) } });
    expect(String(body.summary)).toMatch(/^ReBiomed is up \(slowest answer \d+ ms\)$/);
  });

  it('names the failing probe and its HTTP status, not its URL', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('rebiomed-api') ? new Response('', { status: 502 }) : new Response('ok'),
    );

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(body).toMatchObject({ healthy: false, error: 'ReBiomed: api HTTP 502', metrics: { webMs: expect.any(Number) } });
    expect(JSON.stringify(body)).not.toContain('rebiomed-api:5000');
  });

  it('reports an unreachable app without the network error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND rebiomed-web');
    });

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(body).toEqual({ healthy: false, error: 'ReBiomed: web unreachable, api unreachable' });
  });

  it('does not follow redirects (a redirect is not an answer)', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => new Response('ok'));

    await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('gives up after the timeout instead of hanging the dashboard', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const body = await getStatus({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      probes: [{ name: 'app', url: 'http://clinicreport:8080/healthz' }],
      appName: 'ClinicReport',
      timeoutMs: 50,
    });

    expect(body).toEqual({ healthy: false, error: 'ClinicReport: app unreachable' });
  });
});

describe('parseProbes', () => {
  it('reads name=url pairs and a bare URL', () => {
    expect(parseProbes('web=http://lessons-web/, sync=http://lessons-sync:8080/api/sync/health')).toEqual([
      { name: 'web', url: 'http://lessons-web/' },
      { name: 'sync', url: 'http://lessons-sync:8080/api/sync/health' },
    ]);
    expect(parseProbes('http://clinicreport:8080/healthz?x=1')).toEqual([
      { name: 'app', url: 'http://clinicreport:8080/healthz?x=1' },
    ]);
  });

  it.each([
    ['', 'No probes configured.'],
    ['web=file:///etc/passwd', 'Not an http(s) URL: file:///etc/passwd'],
    ['a=http://x/,a=http://y/', 'Probe names must differ.'],
    ['Web Site=http://x/', 'Odd probe name: Web Site'],
  ])('refuses %j', (spec, message) => {
    expect(() => parseProbes(spec)).toThrow(message);
  });
});
