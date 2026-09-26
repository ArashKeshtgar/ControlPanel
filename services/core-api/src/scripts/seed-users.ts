import * as bcrypt from 'bcryptjs';
import * as sql from 'mssql';

// Creates (or resets the password of) the two built-in accounts. Passwords
// come only from the environment, so no credential ever lives in the repo
// or its README. Resetting a password also bumps TokenVersion, which
// revokes that user's existing refresh tokens.
//
//   ADMIN_PASSWORD=... VIEWER_PASSWORD=... npm run seed:users
const MIN_PASSWORD_LENGTH = 12;

const accounts = [
  { username: 'admin', role: 'Admin', envVar: 'ADMIN_PASSWORD' },
  { username: 'viewer', role: 'Viewer', envVar: 'VIEWER_PASSWORD' },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

async function main() {
  for (const account of accounts) {
    const password = requireEnv(account.envVar);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`${account.envVar} must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  const pool = await new sql.ConnectionPool({
    server: process.env.DB_SERVER ?? 'localhost',
    database: process.env.DB_NAME ?? 'ControlPanelDb',
    user: process.env.DB_USER ?? 'controlpanel_svc',
    password: requireEnv('DB_PASSWORD'),
    options: { trustServerCertificate: true, enableArithAbort: true },
  }).connect();

  try {
    for (const account of accounts) {
      const hash = await bcrypt.hash(requireEnv(account.envVar), 12);
      await pool
        .request()
        .input('username', account.username)
        .input('hash', hash)
        .input('role', account.role)
        .query(`
          IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username = @username)
            UPDATE dbo.Users
            SET PasswordHash = @hash, Role = @role, TokenVersion = TokenVersion + 1
            WHERE Username = @username;
          ELSE
            INSERT INTO dbo.Users (Username, PasswordHash, Role) VALUES (@username, @hash, @role);
        `);
      console.log(`Seeded user '${account.username}' (${account.role}).`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(`seed-users failed: ${(err as Error).message}`);
  process.exit(1);
});
