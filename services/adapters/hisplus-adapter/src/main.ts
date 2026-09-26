import express from 'express';
import sql from 'mssql';

// Direct-DB-read pattern: HIS+ is a pure WinForms desktop app with no HTTP
// API at all, so there's nothing to proxy. Instead this adapter connects
// read-only to its (demo) database and reports real operational metrics
// straight from the same tables the desktop app writes to — the standard
// "reporting service over someone else's OLTP database" integration
// pattern, common in real admin/status portals.
const config: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'HisPlusDemo',
  user: process.env.DB_USER ?? 'controlpanel_svc',
  password: process.env.DB_PASSWORD ?? 'Cp!Dev_2026Local',
  options: { trustServerCertificate: true, enableArithAbort: true },
};

const app = express();
let pool: sql.ConnectionPool;

app.get('/status', async (_req, res) => {
  try {
    const request = pool.request();
    const result = await request.query(`
      SELECT
        COUNT(*) AS TotalReports,
        SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(SYSUTCDATETIME() AS DATE) THEN 1 ELSE 0 END) AS ReportsToday,
        SUM(CASE WHEN IsFinalized = 0 THEN 1 ELSE 0 END) AS PendingReports,
        MAX(CreatedAt) AS LastReportAt
      FROM dbo.ORReports
    `);
    const row = result.recordset[0];

    res.json({
      healthy: true,
      summary: `${row.ReportsToday} OR report(s) today, ${row.PendingReports} pending finalization`,
      metrics: {
        totalReports: row.TotalReports,
        reportsToday: row.ReportsToday,
        pendingReports: row.PendingReports,
        lastReportAt: row.LastReportAt,
      },
    });
  } catch (err) {
    res.json({ healthy: false, error: 'HIS+ database unreachable.' });
  }
});

sql
  .connect(config)
  .then((p) => {
    pool = p;
    app.listen(4002, () => console.log('hisplus-adapter listening on http://localhost:4002'));
  })
  .catch((err) => {
    console.error('Failed to connect to HIS+ database:', err.message);
    process.exit(1);
  });
