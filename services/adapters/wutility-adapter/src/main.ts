import express from 'express';

// Proxy-pattern adapter: wUtility Web already has its own real .NET API
// (services/wUtility Web, http://localhost:5091) — this adapter doesn't
// re-implement anything, it just calls that API and normalizes the result
// into the shape core-api's aggregation expects.
const WUTILITY_API_BASE = process.env.WUTILITY_API_BASE ?? 'http://localhost:5091';

const app = express();

app.get('/status', async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${WUTILITY_API_BASE}/api/db-config-settings`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

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
  } catch (err) {
    res.json({ healthy: false, error: 'wUtility Web API unreachable.' });
  }
});

app.listen(4001, () => console.log('wutility-adapter listening on http://localhost:4001'));
