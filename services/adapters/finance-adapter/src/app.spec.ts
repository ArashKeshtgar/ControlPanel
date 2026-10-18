import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, FinanceQueries, FinanceStatus, SQL } from './app';

// Real Express app on an ephemeral port; only the database is faked.
async function get(queries: FinanceQueries, path: string) {
  const app = createApp(queries);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

const status: FinanceStatus = {
  needsMapping: 2,
  rejected: 1,
  receivedToday: 14,
  receivablesOpen: 12345.6,
  receivablesOver90: 800,
  payablesOpen: 4200.25,
  payablesOverdue: 0,
  openPastMonths: 3,
};

function fakeQueries(overrides: Partial<FinanceQueries> = {}): FinanceQueries {
  return {
    status: async () => status,
    needsMapping: async () => [{ Source: 'labflow', Kind: 'Invoice', Status: 'NeedsMapping' }],
    aging: async () => [{ PartyType: 'OHIP', Over90: 800, Total: 12000 }],
    ...overrides,
  };
}

describe('finance-adapter', () => {
  it('reports the inbox and the open items on /status', async () => {
    const { body } = await get(fakeQueries(), '/status');

    expect(body).toEqual({
      healthy: true,
      summary: '3 document(s) waiting in the inbox, $12,345.60 receivable ($800.00 over 90 days), $4,200.25 payable',
      metrics: status,
    });
  });

  it('treats the NULL sums of empty books as zero', async () => {
    const empty = { ...status, receivablesOpen: null, receivablesOver90: null, payablesOpen: null, payablesOverdue: null };
    const { body } = await get(fakeQueries({ status: async () => empty as unknown as FinanceStatus }), '/status');

    expect(body).toMatchObject({
      healthy: true,
      summary: '3 document(s) waiting in the inbox, $0.00 receivable ($0.00 over 90 days), $0.00 payable',
      metrics: { receivablesOpen: 0, payablesOpen: 0 },
    });
  });

  it('reports unhealthy without leaking the database error', async () => {
    const failing = fakeQueries({ status: async () => { throw new Error('Login failed for user finance_reader'); } });
    const { body } = await get(failing, '/status');

    expect(body).toEqual({ healthy: false, error: 'FinancePowerApp database unreachable.' });
  });

  it.each([
    ['/insights/needs-mapping', 'labflow'],
    ['/insights/aging', 'OHIP'],
  ])('serves %s as rows', async (path, expected) => {
    const { status: code, body } = await get(fakeQueries(), path);

    expect(code).toBe(200);
    expect(JSON.stringify(body.rows)).toContain(expected);
  });

  it('answers 503 on an insight when the database is down', async () => {
    const failing = fakeQueries({ aging: async () => { throw new Error('ETIMEOUT'); } });
    const { status: code, body } = await get(failing, '/insights/aging');

    expect(code).toBe(503);
    expect(body).toEqual({ error: 'FinancePowerApp database unreachable.' });
  });

  it('reads only what finance_reader is granted: no payloads, no party names', () => {
    const all = Object.values(SQL).join('\n');
    expect(all).not.toMatch(/PayloadJson|\bName\b|SELECT \*|JournalLine|gl\.Account/);
  });
});
