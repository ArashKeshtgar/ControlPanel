import express from 'express';

// Direct-DB-read pattern over FinancePowerApp, the group's accounting, with
// the finance_reader login (deploy/finance/sql-login.sql). That login can
// read only the columns these queries use: never a document's payload, an
// account, a journal line or a party's name. No health information is ever
// in this database to begin with (the applications send none).
//
// Besides /status, two read-only /insights endpoints give core-api's
// assistant the inbox documents waiting for a person and the receivables
// by age.
export interface FinanceStatus {
  needsMapping: number;
  rejected: number;
  receivedToday: number;
  receivablesOpen: number;
  receivablesOver90: number;
  payablesOpen: number;
  payablesOverdue: number;
  openPastMonths: number;
}

export interface FinanceQueries {
  status(): Promise<FinanceStatus>;
  needsMapping(): Promise<Array<Record<string, unknown>>>;
  aging(): Promise<Array<Record<string, unknown>>>;
}

export const SQL = {
  // "Today" and "past months" in Toronto, where the books are kept.
  status: `
    DECLARE @today date = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS date);
    SELECT
      (SELECT COUNT(Status) FROM integ.Document WHERE Status = 'NeedsMapping') AS needsMapping,
      (SELECT COUNT(Status) FROM integ.Document WHERE Status = 'Rejected') AS rejected,
      (SELECT COUNT(Status) FROM integ.Document
        WHERE CAST(ReceivedUtc AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time' AS date) = @today) AS receivedToday,
      (SELECT SUM(Balance) FROM ar.Item WHERE Balance <> 0) AS receivablesOpen,
      (SELECT SUM(Balance) FROM ar.Item WHERE Balance <> 0 AND DATEDIFF(day, DueDate, @today) > 90) AS receivablesOver90,
      (SELECT SUM(Balance) FROM ap.Item WHERE Balance <> 0) AS payablesOpen,
      (SELECT SUM(Balance) FROM ap.Item WHERE Balance <> 0 AND DueDate < @today) AS payablesOverdue,
      (SELECT COUNT(IsClosed) FROM dbo.AccountingPeriods
        WHERE IsClosed = 0 AND [Year] * 100 + [Month] < YEAR(@today) * 100 + MONTH(@today)) AS openPastMonths`,
  needsMapping: `
    SELECT TOP 50 Source, Kind, Reference, CONVERT(varchar(10), DocumentDate, 23) AS DocumentDate, Total, Status, Error,
           CONVERT(varchar(19), ReceivedUtc, 126) AS ReceivedUtc
    FROM integ.Document WHERE Status IN ('NeedsMapping', 'Rejected') ORDER BY ReceivedUtc`,
  aging: `
    DECLARE @today date = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS date);
    SELECT p.PartyType,
      SUM(CASE WHEN DATEDIFF(day, i.DueDate, @today) <= 0 THEN i.Balance ELSE 0 END) AS [Current],
      SUM(CASE WHEN DATEDIFF(day, i.DueDate, @today) BETWEEN 1 AND 30 THEN i.Balance ELSE 0 END) AS [Days1to30],
      SUM(CASE WHEN DATEDIFF(day, i.DueDate, @today) BETWEEN 31 AND 60 THEN i.Balance ELSE 0 END) AS [Days31to60],
      SUM(CASE WHEN DATEDIFF(day, i.DueDate, @today) BETWEEN 61 AND 90 THEN i.Balance ELSE 0 END) AS [Days61to90],
      SUM(CASE WHEN DATEDIFF(day, i.DueDate, @today) > 90 THEN i.Balance ELSE 0 END) AS [Over90],
      SUM(i.Balance) AS Total
    FROM ar.Item i JOIN org.Party p ON p.PartyId = i.PartyId
    WHERE i.Balance <> 0
    GROUP BY p.PartyType ORDER BY Total DESC`,
};

const money = (v: number) => `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function createApp(queries: FinanceQueries) {
  const app = express();

  app.get('/status', async (_req, res) => {
    try {
      const s = await queries.status();
      // SUM over no rows is NULL; decimals arrive as numbers from mssql.
      const n = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;
      const metrics = {
        needsMapping: n(s.needsMapping),
        rejected: n(s.rejected),
        receivedToday: n(s.receivedToday),
        receivablesOpen: n(s.receivablesOpen),
        receivablesOver90: n(s.receivablesOver90),
        payablesOpen: n(s.payablesOpen),
        payablesOverdue: n(s.payablesOverdue),
        openPastMonths: n(s.openPastMonths),
      };
      const waiting = metrics.needsMapping + metrics.rejected;
      res.json({
        healthy: true,
        summary:
          `${waiting} document(s) waiting in the inbox, ${money(metrics.receivablesOpen)} receivable ` +
          `(${money(metrics.receivablesOver90)} over 90 days), ${money(metrics.payablesOpen)} payable`,
        metrics,
      });
    } catch {
      res.json({ healthy: false, error: 'FinancePowerApp database unreachable.' });
    }
  });

  const insight = (load: () => Promise<Array<Record<string, unknown>>>) =>
    async (_req: express.Request, res: express.Response) => {
      try {
        res.json({ rows: await load() });
      } catch {
        res.status(503).json({ error: 'FinancePowerApp database unreachable.' });
      }
    };
  app.get('/insights/needs-mapping', insight(() => queries.needsMapping()));
  app.get('/insights/aging', insight(() => queries.aging()));

  return app;
}
