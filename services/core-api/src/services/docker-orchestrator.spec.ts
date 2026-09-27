import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DockerOrchestrator, FetchFn } from './docker-orchestrator';
import { demuxDockerLogs, redactSecrets } from './docker-logs';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

const container = (id: string, labels: Record<string, string>, extra: Partial<Record<string, string>> = {}) => ({
  Id: id, Names: ['/x'], Image: 'img', State: 'running', Status: 'Up 2 minutes (healthy)', Labels: labels,
  ...extra,
});

const managed = (name: string, id = ID_A) =>
  container(id, { 'controlpanel.managed': 'true', 'controlpanel.service': name, 'controlpanel.display': name.toUpperCase() });

// Fake proxy: answers listings from `containers` and records every call.
function fakeDocker(containers: object[], overrides: Record<string, () => Response> = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    const path = url.replace('http://proxy:2375', '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    const key = `${method} ${path.split('?')[0]}`;
    if (overrides[key]) return overrides[key]();
    if (key === 'GET /containers/json') {
      const filters = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('filters') ?? '{}'));
      const wanted: string[] = filters.label ?? [];
      const rows = containers.filter((c) =>
        wanted.every((w) => {
          const [k, v] = w.split('=');
          return (c as { Labels: Record<string, string> }).Labels[k] === v;
        }),
      );
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
  return { fetchFn, calls };
}

async function expectRejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error) {
  try {
    await fn();
    throw new Error('expected a rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(type);
  }
}

describe('DockerOrchestrator', () => {
  it('lists only managed containers, with health parsed from the status', async () => {
    const { fetchFn, calls } = fakeDocker([
      managed('ledgerdash-adapter'),
      container(ID_B, { 'com.docker.compose.service': 'sqlserver' }),
    ]);
    const list = await new DockerOrchestrator('http://proxy:2375', fetchFn).list();
    expect(list).toEqual([
      { name: 'ledgerdash-adapter', displayName: 'LEDGERDASH-ADAPTER', state: 'running', health: 'healthy',
        status: 'Up 2 minutes (healthy)', image: 'img' },
    ]);
    expect(decodeURIComponent(calls[0].path)).toContain('"label":["controlpanel.managed=true"]');
  });

  it('drops a row without the label even if the proxy returns it', async () => {
    const fetchFn: FetchFn = async () =>
      new Response(JSON.stringify([container(ID_B, { 'controlpanel.service': 'sneaky' })]), { status: 200 });
    expect(await new DockerOrchestrator('http://proxy:2375', fetchFn).list()).toEqual([]);
  });

  it('acts on the id from the listing, never on the name it was given', async () => {
    const { fetchFn, calls } = fakeDocker([managed('hisplus-adapter')]);
    await new DockerOrchestrator('http://proxy:2375', fetchFn).start('hisplus-adapter');
    expect(calls.at(-1)).toEqual({ method: 'POST', path: `/containers/${ID_A}/start` });
  });

  it('refuses a container that is not labelled as managed', async () => {
    const { fetchFn, calls } = fakeDocker([container(ID_B, { 'controlpanel.service': 'core-api' })]);
    await expectRejects(() => new DockerOrchestrator('http://proxy:2375', fetchFn).stop('core-api'), NotFoundException);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('refuses names that could change the URL', async () => {
    const { fetchFn, calls } = fakeDocker([managed('x')]);
    const docker = new DockerOrchestrator('http://proxy:2375', fetchFn);
    for (const bad of ['../images', 'x/kill', 'x?t=0', '', 'X']) {
      await expectRejects(() => docker.stop(bad), NotFoundException);
    }
    expect(calls).toEqual([]);
  });

  it('restarts with stop then start (the proxy does not allow restart or kill)', async () => {
    const { fetchFn, calls } = fakeDocker([managed('wutility-adapter')]);
    await new DockerOrchestrator('http://proxy:2375', fetchFn, 7).restart('wutility-adapter');
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(posts).toEqual([`/containers/${ID_A}/stop?t=7`, `/containers/${ID_A}/start`]);
  });

  it('treats 304 (already in that state) as success', async () => {
    const { fetchFn } = fakeDocker([managed('x')], {
      [`POST /containers/${ID_A}/start`]: () => new Response(null, { status: 304 }),
    });
    await expect(new DockerOrchestrator('http://proxy:2375', fetchFn).start('x')).resolves.toBeUndefined();
  });

  it('reports a proxy refusal and an unreachable proxy clearly', async () => {
    const { fetchFn } = fakeDocker([managed('x')], {
      [`POST /containers/${ID_A}/stop`]: () => new Response('Forbidden', { status: 403 }),
    });
    await expectRejects(() => new DockerOrchestrator('http://proxy:2375', fetchFn).stop('x'), BadGatewayException);

    const down: FetchFn = async () => {
      throw new TypeError('fetch failed');
    };
    await expectRejects(() => new DockerOrchestrator('http://proxy:2375', down).list(), ServiceUnavailableException);
  });

  it('refuses when two containers claim the same name', async () => {
    const { fetchFn } = fakeDocker([managed('x', ID_A), managed('x', ID_B)]);
    await expectRejects(() => new DockerOrchestrator('http://proxy:2375', fetchFn).start('x'), BadGatewayException);
  });

  it('caps the log tail and returns demuxed, redacted text', async () => {
    const frame = (stream: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    const raw = Buffer.concat([frame(1, 'listening on 4006\n'), frame(2, 'login failed password=hunter2\n')]);
    const { fetchFn, calls } = fakeDocker([managed('x')], {
      [`GET /containers/${ID_A}/logs`]: () => new Response(raw, { status: 200 }),
    });
    const text = await new DockerOrchestrator('http://proxy:2375', fetchFn).logs('x', 100000);
    expect(text).toBe('listening on 4006\nlogin failed password=[redacted]\n');
    expect(calls.at(-1)?.path).toContain('tail=500');
  });
});

describe('docker log helpers', () => {
  it('passes TTY output through untouched', () => {
    expect(demuxDockerLogs(Buffer.from('plain text line\n'))).toBe('plain text line\n');
  });

  it('masks common credential shapes', () => {
    const out = redactSecrets(
      'Authorization: Bearer abcdefghijklmnop DB_PASSWORD=Sup3r!Secret "apiKey":"k-123" token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEsInR5cCI6ImFjY2VzcyJ9.c2lnbmF0dXJlc2lnbmF0dXJl',
    );
    expect(out).not.toMatch(/abcdefghijklmnop|Sup3r|k-123|eyJhbGci/);
  });
});
