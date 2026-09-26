import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { checkAdapterBaseUrl, parseAllowedHosts } from './adapter-url';
import { AdapterStatus, ProjectRegistryEntry, ProjectWithStatus } from './project.model';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly allowedHosts: string[];

  constructor(
    private db: DatabaseService,
    config: ConfigService,
  ) {
    this.allowedHosts = parseAllowedHosts(config.get<string>('ADAPTER_ALLOWED_HOSTS'));
  }

  async listRegistry(): Promise<ProjectRegistryEntry[]> {
    const result = await this.db
      .request()
      .query('SELECT Id, [Key], DisplayName, Category, AdapterBaseUrl, IsActive FROM dbo.Projects ORDER BY DisplayName');

    return result.recordset.map((r) => ({
      id: r.Id,
      key: r.Key,
      displayName: r.DisplayName,
      category: r.Category,
      adapterBaseUrl: r.AdapterBaseUrl,
      isActive: r.IsActive,
    }));
  }

  // Calls every registered adapter's own /status endpoint in parallel, with
  // a short timeout each — one unreachable adapter never blocks the rest of
  // the dashboard from loading. This is the composition step of the
  // gateway/aggregation pattern: core-api never talks to a project's own
  // database directly, only to its adapter's HTTP contract.
  async listWithStatus(): Promise<ProjectWithStatus[]> {
    const registry = await this.listRegistry();

    return Promise.all(
      registry.map(async (project) => ({
        ...project,
        status: await this.fetchStatus(project),
      })),
    );
  }

  async create(dto: CreateProjectDto): Promise<ProjectRegistryEntry> {
    const adapterBaseUrl = this.normalizeAdapterUrl(dto.adapterBaseUrl);
    const result = await this.db
      .request()
      .input('key', dto.key)
      .input('displayName', dto.displayName)
      .input('category', dto.category)
      .input('adapterBaseUrl', adapterBaseUrl)
      .query(`
        INSERT INTO dbo.Projects ([Key], DisplayName, Category, AdapterBaseUrl)
        OUTPUT INSERTED.Id, INSERTED.[Key], INSERTED.DisplayName, INSERTED.Category, INSERTED.AdapterBaseUrl, INSERTED.IsActive
        VALUES (@key, @displayName, @category, @adapterBaseUrl)
      `);

    const row = result.recordset[0];
    return {
      id: row.Id, key: row.Key, displayName: row.DisplayName,
      category: row.Category, adapterBaseUrl: row.AdapterBaseUrl, isActive: row.IsActive,
    };
  }

  // Partial update — only the fields the caller actually sent are touched,
  // so editing just the port doesn't require re-sending the whole row.
  async update(id: number, dto: UpdateProjectDto): Promise<ProjectRegistryEntry> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException(`Project ${id} not found.`);

    const merged = { ...existing, ...dto };
    if (dto.adapterBaseUrl !== undefined) merged.adapterBaseUrl = this.normalizeAdapterUrl(dto.adapterBaseUrl);

    await this.db
      .request()
      .input('id', id)
      .input('displayName', merged.displayName)
      .input('category', merged.category)
      .input('adapterBaseUrl', merged.adapterBaseUrl)
      .input('isActive', merged.isActive)
      .query(`
        UPDATE dbo.Projects
        SET DisplayName = @displayName, Category = @category,
            AdapterBaseUrl = @adapterBaseUrl, IsActive = @isActive
        WHERE Id = @id
      `);

    return merged;
  }

  async delete(id: number): Promise<void> {
    await this.db.request().input('id', id).query('DELETE FROM dbo.Projects WHERE Id = @id');
  }

  private async findById(id: number): Promise<ProjectRegistryEntry | null> {
    const result = await this.db
      .request()
      .input('id', id)
      .query('SELECT Id, [Key], DisplayName, Category, AdapterBaseUrl, IsActive FROM dbo.Projects WHERE Id = @id');

    const row = result.recordset[0];
    if (!row) return null;
    return {
      id: row.Id, key: row.Key, displayName: row.DisplayName,
      category: row.Category, adapterBaseUrl: row.AdapterBaseUrl, isActive: row.IsActive,
    };
  }

  // Validates against the host allowlist and stores only the URL's origin,
  // so a trailing slash can't turn into `//status` later.
  private normalizeAdapterUrl(value: string): string {
    const problem = checkAdapterBaseUrl(value, this.allowedHosts);
    if (problem) throw new BadRequestException(problem);
    return new URL(value).origin;
  }

  private async fetchStatus(project: ProjectRegistryEntry): Promise<AdapterStatus> {
    // Re-checked at fetch time too: rows written before this check existed,
    // or edited directly in SQL, must not bypass the allowlist.
    const problem = checkAdapterBaseUrl(project.adapterBaseUrl, this.allowedHosts);
    if (problem) return { healthy: false, error: `Adapter URL rejected: ${problem}` };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${new URL(project.adapterBaseUrl).origin}/status`, {
        signal: controller.signal,
        redirect: 'error',
      });
      clearTimeout(timeout);

      if (!response.ok) return { healthy: false, error: `Adapter returned HTTP ${response.status}` };
      return (await response.json()) as AdapterStatus;
    } catch (err) {
      this.logger.warn(`Adapter unreachable for ${project.key}: ${(err as Error).message}`);
      return { healthy: false, error: 'Adapter unreachable.' };
    }
  }
}
