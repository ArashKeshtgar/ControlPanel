import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AuditService } from './audit.service';
import { Orchestrator } from './orchestrator';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

const admin = { sub: 1, username: 'admin' };

function setup(orchestrator: Partial<Orchestrator> | null = {}) {
  const audit = { record: jest.fn(async () => undefined), recent: jest.fn(async () => []) };
  const full: Orchestrator | null = orchestrator && {
    list: jest.fn(async () => []),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    restart: jest.fn(async () => undefined),
    logs: jest.fn(async () => 'line\n'),
    ...orchestrator,
  };
  const service = new ServicesService(full, audit as unknown as AuditService);
  return { service, audit, orchestrator: full };
}

async function expectRejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error) {
  try {
    await fn();
    throw new Error('expected a rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(type);
  }
}

describe('ServicesService', () => {
  it('audits a successful action', async () => {
    const { service, audit, orchestrator } = setup();
    await service.act(admin, 'hisplus-adapter', 'stop');
    expect(orchestrator!.stop).toHaveBeenCalledWith('hisplus-adapter');
    expect(audit.record).toHaveBeenCalledWith(admin, 'stop', 'hisplus-adapter', 'ok');
  });

  it('audits a failed action and still reports the error', async () => {
    const { service, audit } = setup({ start: jest.fn(async () => { throw new NotFoundException('No managed service "x".'); }) });
    await expectRejects(() => service.act(admin, 'x', 'start'), NotFoundException);
    expect(audit.record).toHaveBeenCalledWith(admin, 'start', 'x', 'failed', 'No managed service "x".');
  });

  it('allows one action per service at a time', async () => {
    let finish!: () => void;
    const { service } = setup({ restart: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    const first = service.act(admin, 'x', 'restart');
    await expectRejects(() => service.act(admin, 'x', 'stop'), ConflictException);
    finish();
    await first;
    await expect(service.act(admin, 'x', 'stop')).resolves.toEqual({ name: 'x', action: 'stop' });
  });

  it('answers 503 when no orchestrator is configured', async () => {
    const { service } = setup(null);
    await expectRejects(() => service.list(), ServiceUnavailableException);
  });

  it('audits log reads', async () => {
    const { service, audit } = setup();
    expect(await service.logs(admin, 'x', 50)).toEqual({ name: 'x', lines: 'line\n' });
    expect(audit.record).toHaveBeenCalledWith(admin, 'logs', 'x', 'ok');
  });
});

describe('ServicesController', () => {
  const req = { user: { ...admin, role: 'Admin' as const, typ: 'access' as const } };

  it('requires the name typed back to stop or restart', async () => {
    const { service } = setup();
    const controller = new ServicesController(service);
    expect(() => controller.stop(req, 'x', {})).toThrow(BadRequestException);
    expect(() => controller.restart(req, 'x', { confirm: 'y' })).toThrow(BadRequestException);
    await expect(controller.stop(req, 'x', { confirm: 'x' })).resolves.toEqual({ name: 'x', action: 'stop' });
  });

  it('rejects malformed names before reaching the orchestrator', () => {
    const { service, orchestrator } = setup();
    const controller = new ServicesController(service);
    expect(() => controller.start(req, '../images')).toThrow(BadRequestException);
    expect(orchestrator!.start).not.toHaveBeenCalled();
  });

  it('keeps every control action and logs Admin-only, the list open to any signed-in user', () => {
    const roles = (method: keyof ServicesController) =>
      Reflect.getMetadata(ROLES_KEY, ServicesController.prototype[method] as object);
    for (const m of ['start', 'stop', 'restart', 'logs', 'audit'] as const) expect(roles(m)).toEqual(['Admin']);
    expect(roles('list')).toBeUndefined();
  });
});
