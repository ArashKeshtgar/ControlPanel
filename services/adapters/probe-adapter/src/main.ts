import { createApp, parseProbes } from './app';

// APP_NAME   shown in the summary, e.g. "ClinicReport"
// PROBES     name=url pairs, comma-separated (see parseProbes)
// PORT       the port this adapter listens on (the registry row points at it)
const appName = process.env.APP_NAME;
const spec = process.env.PROBES;
const port = Number(process.env.PORT);
if (!appName || !spec || !Number.isInteger(port) || port <= 0) {
  console.error('APP_NAME, PROBES and PORT must be set.');
  process.exit(1);
}

let probes;
try {
  probes = parseProbes(spec);
} catch (err) {
  console.error(`PROBES: ${(err as Error).message}`);
  process.exit(1);
}

createApp({ appName, probes }).listen(port, () =>
  console.log(`probe-adapter for ${appName} listening on http://localhost:${port}`),
);
