import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp, LabFlowQueries, LabFlowStatus, SQL } from './app';

// Real Express app on an ephemeral port; only the database is faked.
async function getStatus(queries: LabFlowQueries) {
  const app = createApp(queries);
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

const quiet: LabFlowStatus = {
  appointmentsToday: 12,
  openRequisitions: 7,
  resultsToVerify: 4,
  criticalNotCalled: 0,
  electronicOrdersWaiting: 2,
  messagesUnsent: 1,
  messagesFailing: 0,
};

describe('labflow-adapter /status', () => {
  it("reports the day's work", async () => {
    const body = await getStatus({ status: async () => quiet });

    expect(body).toEqual({
      healthy: true,
      summary: '12 appointment(s) today, 7 open requisition(s), 4 result(s) to verify',
      metrics: quiet,
    });
  });

  it('puts a critical value not yet phoned first, and failing result messages last', async () => {
    const body = await getStatus({ status: async () => ({ ...quiet, criticalNotCalled: 1, messagesFailing: 3 }) });

    expect(body.summary).toBe(
      '1 CRITICAL value(s) not yet phoned, 12 appointment(s) today, 7 open requisition(s), 4 result(s) to verify, ' +
        '3 result message(s) to ClinicHub failing',
    );
  });

  it('treats missing counts as zero', async () => {
    const body = await getStatus({ status: async () => ({}) as LabFlowStatus });

    expect(body).toMatchObject({ healthy: true, summary: '0 appointment(s) today, 0 open requisition(s), 0 result(s) to verify' });
  });

  it('reports unhealthy without leaking the database error', async () => {
    const body = await getStatus({ status: async () => { throw new Error('Login failed for user labflow_reader'); } });

    expect(body).toEqual({ healthy: false, error: 'LabFlow database unreachable.' });
  });

  it('counts only: no patient, test or value column is read', () => {
    expect(SQL.status).not.toMatch(/Patient|TestId|Value|Comment|Notes|Payload|SELECT \*/);
  });
});
