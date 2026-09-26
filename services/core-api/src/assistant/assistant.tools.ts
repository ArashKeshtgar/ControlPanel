import Anthropic from '@anthropic-ai/sdk';
import { ProjectsService } from '../projects/projects.service';

// The assistant's entire reach: three read-only tools over data core-api
// already serves. No tool writes, runs SQL, or takes a URL — so whatever a
// tool result contains (a company name, a posting title, an adapter error),
// the worst a model can do with it is answer badly, never act on it.
export const ASSISTANT_TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: 'list_projects',
    description:
      'List every project in the portfolio with its live status from its adapter: whether it is healthy, ' +
      'a one-line summary, the error if it is down, and its metrics. Use this for any overview question.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'get_project_status',
    description:
      "Get one project's live status and metrics by its key (e.g. 'his-plus', 'wutility', 'ledgerdash'). " +
      'Call list_projects first if you do not know the key.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Project key from list_projects.' } },
      required: ['key'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_job_search_insight',
    description:
      'Read job-search analytics from the LedgerDashboard database. ' +
      "'followups': sent applications with no action for more than 7 days, oldest first, and whether a hiring contact's email is on file to follow up with (the address itself is not shared). " +
      "'funnel': outcomes by source (sent, awaiting reply, interviewing, offers, rejected, average match score). " +
      "'gaps': skill-gap tags across postings, with how many appeared in rejected applications.",
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['followups', 'funnel', 'gaps'] } },
      required: ['kind'],
      additionalProperties: false,
    },
    strict: true,
  },
];

// Runs one tool call. Returns the JSON the model sees; throws on bad input
// or a failing source, which the caller reports back as an error result.
export async function runAssistantTool(
  projects: ProjectsService,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'list_projects': {
      const rows = await projects.listWithStatus();
      return JSON.stringify(
        rows.map((p) => ({
          key: p.key,
          name: p.displayName,
          category: p.category,
          active: p.isActive,
          healthy: p.status.healthy,
          summary: p.status.summary,
          error: p.status.error,
          metrics: p.status.metrics,
        })),
      );
    }
    case 'get_project_status': {
      const key = String(input.key ?? '');
      const project = (await projects.listWithStatus()).find((p) => p.key === key);
      if (!project) throw new Error(`No project with key '${key}'. Call list_projects to see the keys.`);
      return JSON.stringify({ key: project.key, name: project.displayName, ...project.status });
    }
    case 'get_job_search_insight': {
      const kind = String(input.kind ?? '');
      if (!['followups', 'funnel', 'gaps'].includes(kind)) throw new Error(`Unknown insight kind '${kind}'.`);
      return JSON.stringify(await projects.fetchAdapterJson('ledgerdash', `/insights/${kind}`));
    }
    default:
      throw new Error(`Unknown tool '${name}'.`);
  }
}
