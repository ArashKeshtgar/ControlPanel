import express from 'express';

// Direct-DB-read pattern: HIS+ is a pure WinForms desktop app with no HTTP
// API at all, so there's nothing to proxy. Instead this adapter connects
// read-only to its (demo) database and reports real operational metrics
// straight from the same tables the desktop app writes to — the standard
// "reporting service over someone else's OLTP database" integration
// pattern, common in real admin/status portals.
export interface OrReportStats {
  TotalReports: number;
  ReportsToday: number | null;
  PendingReports: number | null;
  LastReportAt: Date | null;
}

export const OR_REPORT_STATS_SQL = `
  SELECT
    COUNT(*) AS TotalReports,
    SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(SYSUTCDATETIME() AS DATE) THEN 1 ELSE 0 END) AS ReportsToday,
    SUM(CASE WHEN IsFinalized = 0 THEN 1 ELSE 0 END) AS PendingReports,
    MAX(CreatedAt) AS LastReportAt
  FROM dbo.ORReports
`;

// The query is injected so tests can run without a SQL Server.
export function createApp(loadStats: () => Promise<OrReportStats>) {
  const app = express();

  app.get('/status', async (_req, res) => {
    try {
      const row = await loadStats();
      // SUM over an empty table is NULL, not 0.
      const reportsToday = row.ReportsToday ?? 0;
      const pendingReports = row.PendingReports ?? 0;

      res.json({
        healthy: true,
        summary: `${reportsToday} OR report(s) today, ${pendingReports} pending finalization`,
        metrics: {
          totalReports: row.TotalReports,
          reportsToday,
          pendingReports,
          lastReportAt: row.LastReportAt ? new Date(row.LastReportAt).toISOString() : 'none',
        },
      });
    } catch {
      res.json({ healthy: false, error: 'HIS+ database unreachable.' });
    }
  });

  return app;
}
