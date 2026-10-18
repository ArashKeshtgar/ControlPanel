import sql from 'mssql';
import { createApp, FinanceStatus, SQL } from './app';

// finance_reader can only SELECT the columns the queries use
// (deploy/finance/sql-login.sql). No default password — a missing one is a
// configuration error.
const password = process.env.DB_PASSWORD;
if (!password) {
  console.error('DB_PASSWORD must be set (the finance_reader login password).');
  process.exit(1);
}

const config: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'FinancePowerApp',
  user: process.env.DB_USER ?? 'finance_reader',
  password,
  options: { trustServerCertificate: true, enableArithAbort: true },
};

// Connects on first use and again after a failure, rather than exiting when
// the database isn't there yet: the database may be created after this
// container starts, and the dashboard should say "unreachable" meanwhile.
let pool: Promise<sql.ConnectionPool> | null = null;
async function rows<T>(text: string): Promise<T[]> {
  pool ??= new sql.ConnectionPool(config).connect();
  try {
    return (await (await pool).request().query<T>(text)).recordset;
  } catch (err) {
    const failed = pool;
    pool = null;
    (await failed.catch(() => null))?.close().catch(() => undefined);
    throw err;
  }
}

const app = createApp({
  status: async () => (await rows<FinanceStatus>(SQL.status))[0],
  needsMapping: () => rows(SQL.needsMapping),
  aging: () => rows(SQL.aging),
});
app.listen(4016, () => console.log('finance-adapter listening on http://localhost:4016'));
