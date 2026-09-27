import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { demuxDockerLogs, redactSecrets } from './docker-logs';
import {
  DISPLAY_LABEL, MANAGED_LABEL, ManagedService, NAME_LABEL, Orchestrator, SERVICE_NAME_PATTERN,
} from './orchestrator';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
}

// Talks to the Docker Engine API through a socket proxy (never the raw
// socket). Two layers of least privilege:
//   1. The proxy only forwards list, logs, start and stop. create, exec,
//      delete, kill, restart, images and volumes are refused there, so even
//      a bug here can't escalate to running arbitrary containers.
//   2. This class only acts on containers labelled controlpanel.managed=true,
//      found by name in a fresh listing; the id sent to Docker always comes
//      from that listing, never from the caller.
// Restart is stop + start because the proxy's restart permission also
// allows kill.
export class DockerOrchestrator implements Orchestrator {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly stopTimeoutSeconds = 10,
  ) {}

  async list(): Promise<ManagedService[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }));
    const res = await this.call('GET', `/containers/json?all=1&filters=${filters}`, 5000);
    const containers = (await res.json()) as DockerContainer[];
    return containers
      // Don't trust the filter alone: re-check the label on every row.
      .filter((c) => c.Labels?.[MANAGED_LABEL] === 'true' && SERVICE_NAME_PATTERN.test(nameOf(c)))
      .map(toService)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async start(name: string): Promise<void> {
    const id = await this.resolve(name);
    await this.call('POST', `/containers/${id}/start`, 15000);
  }

  async stop(name: string): Promise<void> {
    const id = await this.resolve(name);
    const t = this.stopTimeoutSeconds;
    await this.call('POST', `/containers/${id}/stop?t=${t}`, (t + 5) * 1000);
  }

  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  async logs(name: string, tail: number): Promise<string> {
    const id = await this.resolve(name);
    const n = Math.max(1, Math.min(500, Math.floor(tail) || 200));
    const res = await this.call('GET', `/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${n}`, 5000);
    const text = demuxDockerLogs(Buffer.from(await res.arrayBuffer()));
    return redactSecrets(text);
  }

  private async resolve(name: string): Promise<string> {
    if (!SERVICE_NAME_PATTERN.test(name)) throw new NotFoundException(`No managed service "${name}".`);
    const filters = encodeURIComponent(JSON.stringify({ label: [`${MANAGED_LABEL}=true`, `${NAME_LABEL}=${name}`] }));
    const res = await this.call('GET', `/containers/json?all=1&filters=${filters}`, 5000);
    const matches = ((await res.json()) as DockerContainer[]).filter(
      (c) => c.Labels?.[MANAGED_LABEL] === 'true' && c.Labels?.[NAME_LABEL] === name,
    );
    if (matches.length === 0) throw new NotFoundException(`No managed service "${name}".`);
    if (matches.length > 1) throw new BadGatewayException(`More than one container is labelled "${name}".`);
    const id = matches[0].Id;
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new BadGatewayException('Docker returned an unexpected container id.');
    return id;
  }

  private async call(method: 'GET' | 'POST', path: string, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException('The Docker socket proxy is unreachable.');
    }
    // 304: already started / already stopped, which is what was asked for.
    if (res.ok || res.status === 304) return res;
    if (res.status === 404) throw new NotFoundException('Docker no longer knows this container.');
    if (res.status === 403) throw new BadGatewayException('The Docker socket proxy refused this operation.');
    throw new BadGatewayException(`Docker answered HTTP ${res.status}.`);
  }
}

function nameOf(c: DockerContainer): string {
  return c.Labels?.[NAME_LABEL] ?? '';
}

function toService(c: DockerContainer): ManagedService {
  const name = nameOf(c);
  const health = /\(healthy\)/.test(c.Status) ? 'healthy'
    : /\(unhealthy\)/.test(c.Status) ? 'unhealthy'
    : /health: starting/.test(c.Status) ? 'starting'
    : 'none';
  return {
    name,
    displayName: c.Labels?.[DISPLAY_LABEL] || name,
    state: c.State,
    health,
    status: c.Status,
    image: c.Image,
  };
}
