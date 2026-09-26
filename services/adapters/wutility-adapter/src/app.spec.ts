import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, WutilityAdapterOptions } from './app';

// Starts the real Express app on an ephemeral port and calls it over HTTP;
// only the upstream wUtility API is faked (via fetchImpl).
async function getStatus(options: Partial<WutilityAdapterOptions>) {
  const app = createApp({ apiBase: 'http://wutility.test', apiKey: 'test-key', ...options });
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('wutility-adapter /status', () => {
  it('summarizes active vs total site databases and sends the API key', async () => {
    const fetchImpl = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse([{ fldIsActive: true }, { fldIsActive: false }, { fldIsActive: true }]),
    );

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(body).toEqual({
      healthy: true,
      summary: '2 of 3 registered site databases active',
      metrics: { totalSites: 3, activeSites: 2 },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://wutility.test/api/db-config-settings');
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('reports unhealthy with the upstream status code when the API rejects the call', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, 401));

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(body).toEqual({ healthy: false, error: 'wUtility API returned HTTP 401' });
  });

  it('reports unhealthy instead of throwing when the API is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(body).toEqual({ healthy: false, error: 'wUtility Web API unreachable.' });
  });

  it('gives up after the timeout instead of hanging the dashboard', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const body = await getStatus({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 });

    expect(body).toEqual({ healthy: false, error: 'wUtility Web API unreachable.' });
  });
});
