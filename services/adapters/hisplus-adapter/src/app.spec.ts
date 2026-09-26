import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, OrReportStats } from './app';

// Starts the real Express app on an ephemeral port and calls it over HTTP;
// only the database query is faked.
async function getStatus(loadStats: () => Promise<OrReportStats>) {
  const app = createApp(loadStats);
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

describe('hisplus-adapter /status', () => {
  it('reports OR report metrics from the database row', async () => {
    const body = await getStatus(async () => ({
      TotalReports: 4,
      ReportsToday: 3,
      PendingReports: 1,
      LastReportAt: new Date('2026-09-26T08:00:00Z'),
    }));

    expect(body).toEqual({
      healthy: true,
      summary: '3 OR report(s) today, 1 pending finalization',
      metrics: { totalReports: 4, reportsToday: 3, pendingReports: 1, lastReportAt: '2026-09-26T08:00:00.000Z' },
    });
  });

  it('treats the NULL sums of an empty table as zero', async () => {
    const body = await getStatus(async () => ({
      TotalReports: 0,
      ReportsToday: null,
      PendingReports: null,
      LastReportAt: null,
    }));

    expect(body).toMatchObject({
      healthy: true,
      summary: '0 OR report(s) today, 0 pending finalization',
      metrics: { totalReports: 0, reportsToday: 0, pendingReports: 0, lastReportAt: 'none' },
    });
  });

  it('reports unhealthy without leaking the database error', async () => {
    const body = await getStatus(async () => {
      throw new Error('Login failed for user controlpanel_svc');
    });

    expect(body).toEqual({ healthy: false, error: 'HIS+ database unreachable.' });
  });
});
