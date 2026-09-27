import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  id: number;
  at: string;
  username: string;
  action: string;
  target: string;
  outcome: 'ok' | 'failed';
  detail: string | null;
}

export interface AuditActor {
  sub: number;
  username: string;
}

// Who did what to which service, and whether it worked. Rows are only ever
// inserted; nothing in core-api updates or deletes them.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private db: DatabaseService) {}

  async record(actor: AuditActor, action: string, target: string, outcome: 'ok' | 'failed', detail?: string) {
    try {
      await this.db
        .request()
        .input('userId', actor.sub)
        .input('username', actor.username)
        .input('action', action)
        .input('target', target)
        .input('outcome', outcome)
        .input('detail', detail ? detail.slice(0, 400) : null)
        .query(`INSERT INTO dbo.AuditLog (UserId, Username, Action, Target, Outcome, Detail)
                VALUES (@userId, @username, @action, @target, @outcome, @detail)`);
    } catch (err) {
      // The action already happened; losing the row must at least be loud.
      this.logger.error(`Audit write failed for ${actor.username} ${action} ${target}: ${(err as Error).message}`);
    }
  }

  async recent(limit = 50): Promise<AuditEntry[]> {
    const result = await this.db
      .request()
      .input('limit', Math.max(1, Math.min(200, limit)))
      .query(`SELECT TOP (@limit) Id, At, Username, Action, Target, Outcome, Detail
              FROM dbo.AuditLog ORDER BY Id DESC`);
    return result.recordset.map((r) => ({
      id: r.Id,
      at: new Date(r.At).toISOString(),
      username: r.Username,
      action: r.Action,
      target: r.Target,
      outcome: r.Outcome,
      detail: r.Detail,
    }));
  }
}
