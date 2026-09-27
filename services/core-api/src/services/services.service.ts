import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuditActor, AuditService } from './audit.service';
import { ManagedService, ORCHESTRATOR, Orchestrator } from './orchestrator';

export type ServiceAction = 'start' | 'stop' | 'restart';

// Wraps the orchestrator with what every control action needs: one action
// per service at a time, and an audit row for every attempt, including the
// ones that fail.
@Injectable()
export class ServicesService {
  private readonly busy = new Set<string>();

  constructor(
    @Inject(ORCHESTRATOR) private orchestrator: Orchestrator | null,
    private audit: AuditService,
  ) {}

  list(): Promise<ManagedService[]> {
    return this.require().list();
  }

  async act(actor: AuditActor, name: string, action: ServiceAction): Promise<{ name: string; action: ServiceAction }> {
    const orchestrator = this.require();
    if (this.busy.has(name)) throw new ConflictException(`An action on "${name}" is already running.`);
    this.busy.add(name);
    try {
      await orchestrator[action](name);
      await this.audit.record(actor, action, name, 'ok');
      return { name, action };
    } catch (err) {
      await this.audit.record(actor, action, name, 'failed', (err as Error).message);
      throw err;
    } finally {
      this.busy.delete(name);
    }
  }

  async logs(actor: AuditActor, name: string, tail: number): Promise<{ name: string; lines: string }> {
    const lines = await this.require().logs(name, tail);
    await this.audit.record(actor, 'logs', name, 'ok');
    return { name, lines };
  }

  auditLog(limit?: number) {
    return this.audit.recent(limit);
  }

  private require(): Orchestrator {
    if (!this.orchestrator) {
      throw new ServiceUnavailableException('Service control is off: DOCKER_PROXY_URL is not set.');
    }
    return this.orchestrator;
  }
}
