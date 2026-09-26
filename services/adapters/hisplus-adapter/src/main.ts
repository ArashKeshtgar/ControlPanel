import sql from 'mssql';
import { createApp, OR_REPORT_STATS_SQL, OrReportStats } from './app';

// No default password: a missing DB_PASSWORD is a configuration error, not
// something to paper over with a value committed to a public repo.
const password = process.env.DB_PASSWORD;
if (!password) {
  console.error('DB_PASSWORD must be set (the controlpanel_svc login password).');
  process.exit(1);
}

const config: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'HisPlusDemo',
  user: process.env.DB_USER ?? 'controlpanel_svc',
  password,
  options: { trustServerCertificate: true, enableArithAbort: true },
};

sql
  .connect(config)
  .then((pool) => {
    const app = createApp(async () => {
      const result = await pool.request().query<OrReportStats>(OR_REPORT_STATS_SQL);
      return result.recordset[0];
    });
    app.listen(4002, () => console.log('hisplus-adapter listening on http://localhost:4002'));
  })
  .catch((err) => {
    console.error('Failed to connect to HIS+ database:', err.message);
    process.exit(1);
  });
