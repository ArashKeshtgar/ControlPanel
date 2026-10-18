#!/bin/bash
# Creates and upgrades FinancePowerApp's and PharmaFlow's databases in the
# container SQL Server, then (re)creates their logins, LabFlow's read-only
# adapter login and ClinicHub's (which creates its own databases). Run by the one-shot app-db-init service in
# compose.vps.yml on every `docker compose up`, so a new server gets both
# demos without a manual step and a pull that adds a script applies it.
#
# It does what each repo's database/deploy.ps1 does on Windows: run every
# numbered script once, in order, and record it in the database's
# migrations table (FinancePowerApp: dbo.ErpMigration, PharmaFlow:
# dbo.SchemaMigration), so both tools agree on what has run. A new database
# gets the synthetic demo data too: this is the public demo, never real books
# or patients.
set -euo pipefail

SQLCMD=/opt/mssql-tools18/bin/sqlcmd
: "${SA_PASSWORD:?SA_PASSWORD is required}"
: "${FINANCE_DB_PASSWORD:?FINANCE_DB_PASSWORD is required}"
: "${FINANCE_READER_PASSWORD:?FINANCE_READER_PASSWORD is required}"
: "${PHARMAFLOW_DB_PASSWORD:?PHARMAFLOW_DB_PASSWORD is required}"
: "${LABFLOW_READER_PASSWORD:?LABFLOW_READER_PASSWORD is required}"
: "${CLINICHUB_DB_PASSWORD:?CLINICHUB_DB_PASSWORD is required}"

sql() { "$SQLCMD" -C -b -S sqlserver -U sa -P "$SA_PASSWORD" -I -f 65001 "$@"; }

# migrate <database> <migrations table> <scripts folder>
migrate() {
  local db="$1" table="$2" dir="$3" f name
  [[ -d "$dir" ]] || { echo "No $dir: is the repo cloned and mounted?" >&2; exit 1; }
  sql -d master -Q "IF DB_ID(N'$db') IS NULL CREATE DATABASE [$db]"
  sql -d "$db" -Q "IF OBJECT_ID(N'dbo.$table') IS NULL CREATE TABLE dbo.$table (Script nvarchar(200) NOT NULL PRIMARY KEY, AppliedUtc datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME())"
  local applied
  applied="$(sql -d "$db" -h -1 -W -Q "SET NOCOUNT ON; SELECT Script FROM dbo.$table")"
  for f in "$dir"/[0-9][0-9][0-9]_*.sql; do
    name="$(basename "$f")"
    grep -qxF "$name" <<<"$applied" && continue
    echo "==> $db  $name"
    sql -d "$db" -i "$f"
    sql -d "$db" -Q "SET NOCOUNT ON; INSERT dbo.$table (Script) VALUES (N'$name')"
  done
  echo "$db is up to date."
}

migrate FinancePowerApp ErpMigration /apps/finance
migrate PharmaFlow SchemaMigration /apps/pharmaflow

sql -i /deploy/finance/sql-login.sql \
  -v FINANCE_DB_PASSWORD="$FINANCE_DB_PASSWORD" -v FINANCE_READER_PASSWORD="$FINANCE_READER_PASSWORD" >/dev/null
sql -i /deploy/pharmaflow/sql-login.sql -v PHARMAFLOW_DB_PASSWORD="$PHARMAFLOW_DB_PASSWORD" >/dev/null
sql -i /deploy/clinichub/sql-login.sql -v CLINICHUB_DB_PASSWORD="$CLINICHUB_DB_PASSWORD" >/dev/null

# LabFlow's database comes from a backup (restore-db.sh); until it's there,
# there's nothing to grant on.
if [[ "$(sql -d master -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'LabFlow') IS NULL THEN 0 ELSE 1 END")" == 1 ]]; then
  sql -i /deploy/labflow/reader-login.sql -v LABFLOW_READER_PASSWORD="$LABFLOW_READER_PASSWORD" >/dev/null
fi
echo "App databases ready."
