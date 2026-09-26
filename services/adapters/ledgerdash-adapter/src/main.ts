import sql from 'mssql';
import { createApp, LedgerStatus, SQL } from './app';

// ledger_reader can only SELECT the reporting views (LedgerDashboard
// db/05-reader-login.sql). No default password — a missing one is a
// configuration error.
const password = process.env.DB_PASSWORD;
if (!password) {
  console.error('DB_PASSWORD must be set (the ledger_reader login password).');
  process.exit(1);
}

const config: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'LedgerDashboard',
  user: process.env.DB_USER ?? 'ledger_reader',
  password,
  options: { trustServerCertificate: true, enableArithAbort: true },
};

sql
  .connect(config)
  .then((pool) => {
    const rows = async <T>(text: string) => (await pool.request().query<T>(text)).recordset;
    const app = createApp({
      status: async () => (await rows<LedgerStatus>(SQL.status))[0],
      followupsDue: () => rows(SQL.followupsDue),
      funnelBySource: () => rows(SQL.funnelBySource),
      gapTags: () => rows(SQL.gapTags),
    });
    app.listen(4006, () => console.log('ledgerdash-adapter listening on http://localhost:4006'));
  })
  .catch((err) => {
    console.error('Failed to connect to the LedgerDashboard database:', err.message);
    process.exit(1);
  });
