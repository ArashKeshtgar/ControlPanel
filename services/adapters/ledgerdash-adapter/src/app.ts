import express from 'express';

// Direct-DB-read pattern over LedgerDashboard's SQL Server database, like
// hisplus-adapter — but through the reporting views (db/04-views.sql in the
// LedgerDashboard repo) with the read-only ledger_reader login, which can't
// see the tables at all. The views compute the same current stage and
// follow-up rule as the dashboard itself, so the numbers match its UI.
//
// Besides the /status contract every adapter has, three read-only
// /insights endpoints give core-api's assistant structured answers.
export interface LedgerStatus {
  sent: number;
  awaitingReply: number;
  interviewing: number;
  offers: number;
  rejected: number;
  drafts: number;
  followupsDue: number;
}

export interface LedgerQueries {
  status(): Promise<LedgerStatus>;
  followupsDue(): Promise<Array<Record<string, unknown>>>;
  funnelBySource(): Promise<Array<Record<string, unknown>>>;
  gapTags(): Promise<Array<Record<string, unknown>>>;
}

export const SQL = {
  status: `
    SELECT
      SUM(CASE WHEN CurrentStage <> 'draft' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN CurrentStage = 'applied' THEN 1 ELSE 0 END) AS awaitingReply,
      SUM(CASE WHEN CurrentStage IN ('recruiter_screen', 'technical_interview', 'final_round') THEN 1 ELSE 0 END) AS interviewing,
      SUM(CASE WHEN CurrentStage IN ('offer', 'contract_signed') THEN 1 ELSE 0 END) AS offers,
      SUM(CASE WHEN CurrentStage = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN CurrentStage = 'draft' THEN 1 ELSE 0 END) AS drafts,
      (SELECT COUNT(*) FROM dbo.vFollowupsDue) AS followupsDue
    FROM dbo.vApplicationCurrentStage`,
  followupsDue: `
    SELECT Company, Role, CurrentStage, CONVERT(varchar(10), LastActionDate, 23) AS LastActionDate, DaysSinceAction
    FROM dbo.vFollowupsDue ORDER BY DaysSinceAction DESC`,
  funnelBySource: `SELECT * FROM dbo.vFunnelBySource ORDER BY Sent DESC`,
  gapTags: `
    SELECT TOP 25 Slug, Postings, RejectedPostings, AvgMatchScore
    FROM dbo.vGapTagStats ORDER BY RejectedPostings DESC, Postings DESC, Slug`,
};

export function createApp(queries: LedgerQueries) {
  const app = express();

  app.get('/status', async (_req, res) => {
    try {
      const s = await queries.status();
      const n = (v: number | null | undefined) => v ?? 0; // SUM over no rows is NULL
      const metrics = {
        sent: n(s.sent),
        awaitingReply: n(s.awaitingReply),
        interviewing: n(s.interviewing),
        offers: n(s.offers),
        rejected: n(s.rejected),
        drafts: n(s.drafts),
        followupsDue: n(s.followupsDue),
      };
      res.json({
        healthy: true,
        summary:
          `${metrics.sent} sent, ${metrics.interviewing} interviewing, ` +
          `${metrics.followupsDue} follow-up(s) due, ${metrics.drafts} draft(s) waiting`,
        metrics,
      });
    } catch {
      res.json({ healthy: false, error: 'LedgerDashboard database unreachable.' });
    }
  });

  // Read-only lists for the assistant. Errors are reported, never leaked.
  const insight = (load: () => Promise<Array<Record<string, unknown>>>) =>
    async (_req: express.Request, res: express.Response) => {
      try {
        res.json({ rows: await load() });
      } catch {
        res.status(503).json({ error: 'LedgerDashboard database unreachable.' });
      }
    };
  app.get('/insights/followups', insight(() => queries.followupsDue()));
  app.get('/insights/funnel', insight(() => queries.funnelBySource()));
  app.get('/insights/gaps', insight(() => queries.gapTags()));

  return app;
}
