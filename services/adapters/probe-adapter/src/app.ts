import express from 'express';

// Probe pattern, the smallest proxy adapter: for an app whose only public,
// unauthenticated surface is a health endpoint or its front page (ClinicHub,
// ClinicReport, PharmaFlow, ReBiomed, the English lessons). It calls each
// configured URL and reports whether all of them answered 2xx, and how fast.
// One image serves every such app; each runs as its own container with its
// own APP_NAME, PROBES and PORT, so core-api still sees one adapter per app.
export interface Probe {
  name: string;
  url: string;
}

export interface ProbeAdapterOptions {
  appName: string;
  probes: Probe[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// "web=http://rebiomed-web/,api=http://rebiomed-api:5000/api/categories"
// A single URL without a name is called "app".
export function parseProbes(spec: string): Probe[] {
  const probes = spec
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      const [name, url] = eq > 0 && !part.slice(0, eq).includes(':') ? [part.slice(0, eq), part.slice(eq + 1)] : ['app', part];
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Not an http(s) URL: ${url}`);
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Odd probe name: ${name}`);
      return { name, url };
    });
  if (probes.length === 0) throw new Error('No probes configured.');
  if (new Set(probes.map((p) => p.name)).size !== probes.length) throw new Error('Probe names must differ.');
  return probes;
}

type ProbeResult = { name: string; ok: boolean; ms: number; problem?: string };

export function createApp({ appName, probes, timeoutMs = 3000, fetchImpl = fetch, now = Date.now }: ProbeAdapterOptions) {
  const app = express();

  const probeOne = async ({ name, url }: Probe): Promise<ProbeResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual' });
      // Drain the body so the connection is released; its content isn't used.
      await response.arrayBuffer().catch(() => undefined);
      const ms = Math.round(now() - started);
      return response.ok ? { name, ok: true, ms } : { name, ok: false, ms, problem: `HTTP ${response.status}` };
    } catch {
      return { name, ok: false, ms: Math.round(now() - started), problem: 'unreachable' };
    } finally {
      clearTimeout(timeout);
    }
  };

  app.get('/status', async (_req, res) => {
    const results = await Promise.all(probes.map(probeOne));
    const metrics: Record<string, number> = {};
    for (const r of results) if (r.ok) metrics[`${r.name}Ms`] = r.ms;
    const failed = results.filter((r) => !r.ok);

    if (failed.length === 0) {
      const slowest = Math.max(...results.map((r) => r.ms));
      res.json({ healthy: true, summary: `${appName} is up (slowest answer ${slowest} ms)`, metrics });
    } else {
      // Only the probe's name and the HTTP status or "unreachable", never the
      // URL or the network error, which would show internal host names.
      const what = failed.map((r) => `${r.name} ${r.problem}`).join(', ');
      res.json({ healthy: false, error: `${appName}: ${what}`, ...(Object.keys(metrics).length ? { metrics } : {}) });
    }
  });

  return app;
}
