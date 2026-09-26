import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, LedgerQueries, LedgerStatus } from './app';

// Real Express app on an ephemeral port; only the database is faked.
async function get(queries: LedgerQueries, path: string) {
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

const status: LedgerStatus = {
  sent: 36, awaitingReply: 31, interviewing: 0, offers: 0, rejected: 5, drafts: 3, followupsDue: 11,
};

function fakeQueries(overrides: Partial<LedgerQueries> = {}): LedgerQueries {
  return {
    status: async () => status,
    followupsDue: async () => [{ Company: 'Acme', DaysSinceAction: 9 }],
    funnelBySource: async () => [{ Source: 'linkedin', Sent: 29 }],
    gapTags: async () => [{ Slug: 'etl-ssis', Postings: 3, RejectedPostings: 2 }],
    ...overrides,
  };
}

describe('ledgerdash-adapter', () => {
  it('reports the job-search pipeline on /status', async () => {
    const { body } = await get(fakeQueries(), '/status');

    expect(body).toEqual({
      healthy: true,
      summary: '36 sent, 0 interviewing, 11 follow-up(s) due, 3 draft(s) waiting',
      metrics: status,
    });
  });

  it('treats the NULL sums of an empty database as zero', async () => {
    const empty = { sent: null, awaitingReply: null, interviewing: null, offers: null, rejected: null, drafts: null, followupsDue: 0 };
    const { body } = await get(fakeQueries({ status: async () => empty as unknown as LedgerStatus }), '/status');

    expect(body).toMatchObject({ healthy: true, summary: '0 sent, 0 interviewing, 0 follow-up(s) due, 0 draft(s) waiting' });
  });

  it('reports unhealthy without leaking the database error', async () => {
    const failing = fakeQueries({ status: async () => { throw new Error('Login failed for user ledger_reader'); } });
    const { body } = await get(failing, '/status');

    expect(body).toEqual({ healthy: false, error: 'LedgerDashboard database unreachable.' });
  });

  it.each([
    ['/insights/followups', 'Acme'],
    ['/insights/funnel', 'linkedin'],
    ['/insights/gaps', 'etl-ssis'],
  ])('serves %s as rows', async (path, expected) => {
    const { status: code, body } = await get(fakeQueries(), path);

    expect(code).toBe(200);
    expect(JSON.stringify(body.rows)).toContain(expected);
  });

  it('answers 503 on an insights endpoint when the database is down', async () => {
    const failing = fakeQueries({ gapTags: async () => { throw new Error('boom'); } });
    const { status: code, body } = await get(failing, '/insights/gaps');

    expect(code).toBe(503);
    expect(body).toEqual({ error: 'LedgerDashboard database unreachable.' });
  });
});
