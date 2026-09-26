import express from 'express';

// Proxy-pattern adapter: wUtility Web already has its own real .NET API —
// this adapter doesn't re-implement anything, it just calls that API and
// normalizes the result into the shape core-api's aggregation expects.
export interface WutilityAdapterOptions {
  apiBase: string;
  // Sent as X-Api-Key; wUtility's API rejects /api/* requests without it.
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createApp({ apiBase, apiKey, timeoutMs = 3000, fetchImpl = fetch }: WutilityAdapterOptions) {
  const app = express();

  app.get('/status', async (_req, res) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}/api/db-config-settings`, {
        signal: controller.signal,
        headers: { 'X-Api-Key': apiKey },
      });

      if (!response.ok) {
        return res.json({ healthy: false, error: `wUtility API returned HTTP ${response.status}` });
      }

      const settings = (await response.json()) as Array<{ fldIsActive: boolean }>;
      const active = settings.filter((s) => s.fldIsActive).length;

      res.json({
        healthy: true,
        summary: `${active} of ${settings.length} registered site databases active`,
        metrics: { totalSites: settings.length, activeSites: active },
      });
    } catch {
      res.json({ healthy: false, error: 'wUtility Web API unreachable.' });
    } finally {
      clearTimeout(timeout);
    }
  });

  return app;
}
