#!/usr/bin/env bash
# Applies each app's database schema scripts to the container SQL Server,
# after deploy.sh has pulled the new code. The scripts are idempotent (they
# create only what's missing, views are CREATE OR ALTER), so this is safe to
# run on every release, and a release that changes no schema changes nothing.
#
#   deploy/vps/migrate.sh
#
# Data is never touched here: production data lives only on this server.
set -euo pipefail

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
cd "$CP"

# run_sql_file <script> [sqlcmd args ...]
run_sql_file() {
  local file="$1"; shift
  # Through stdin, so the temp file belongs to mssql and it can delete it.
  docker compose exec -T sqlserver bash -c \
    'f=$(mktemp); cat > "$f"; /opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -i "$f" "$@"; rc=$?; rm -f "$f"; exit $rc' _ "$@" < "$file"
}

# LedgerDashboard: tables, the reader views, the rpt reporting schema.
# (01 creates the database and 02/05 the logins: first install only.)
LD="$ROOT/LedgerDashboard/db"
if [[ -d "$LD" ]]; then
  for f in 03-schema.sql 04-views.sql 06-report-views.sql; do
    echo "==> LedgerDashboard  $f"
    run_sql_file "$LD/$f" -d LedgerDashboard >/dev/null
  done
fi

# ---- The clinic platform (deploy/vps/compose.clinic.yml), when it is on.
if grep -qE '^COMPOSE_FILE=.*compose\.clinic\.yml' .env; then
  SECRETS="$(grep -E '^CLINIC_SECRETS_DIR=' .env | cut -d= -f2- || true)"
  SECRETS="${SECRETS:-/srv/secrets/clinic}"
  secret() { cat "$SECRETS/$1"; }

  sql() {
    docker compose exec -T sqlserver bash -c \
      '/opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -h -1 -W -Q "$1"' _ "$1"
  }

  # PharmaFlow and FinancePowerApp: what their database/deploy.ps1 does on Windows. Each numbered script runs once,
  # in order, and is recorded in the database's own table; the demo seeds are synthetic and run too.
  # migrate_db <database> <repo folder> <record table>
  migrate_db() {
    local db="$1" dir="$2/database" table="$3" applied f name
    sql "IF DB_ID(N'$db') IS NULL CREATE DATABASE [$db]" >/dev/null
    sql "USE [$db]; IF OBJECT_ID(N'dbo.$table') IS NULL CREATE TABLE dbo.$table (Script nvarchar(200) NOT NULL PRIMARY KEY, AppliedUtc datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME())" >/dev/null
    applied="$(sql "SET NOCOUNT ON; USE [$db]; SELECT Script FROM dbo.$table")"
    for f in "$dir"/[0-9][0-9][0-9]_*.sql; do
      name="$(basename "$f")"
      grep -qxF "$name" <<<"$applied" && continue
      echo "==> $db  $name"
      # -I: quoted identifiers (filtered indexes); -f 65001: the scripts are UTF-8.
      run_sql_file "$f" -d "$db" -I -f 65001 >/dev/null
      sql "USE [$db]; INSERT dbo.$table (Script) VALUES (N'$name')" >/dev/null
    done
  }
  migrate_db PharmaFlow "$ROOT/PharmaFlow" SchemaMigration
  migrate_db FinancePowerApp "$ROOT/FinancePowerApp" ErpMigration

  echo "==> Clinic logins"
  run_sql_file deploy/clinic/sql-logins.sql -v "CLINICHUB_DB_PASSWORD=$(secret clinichub-db-password)" \
    "PHARMAFLOW_DB_PASSWORD=$(secret pharmaflow-db-password)" "FINANCE_DB_PASSWORD=$(secret finance-db-password)" >/dev/null
  # Analytics reads the books through FinancePowerApp's own read-only login script.
  run_sql_file "$ROOT/FinancePowerApp/database/tools/analytics_reader.sql" -d FinancePowerApp -I \
    -v "ReaderPassword=$(secret analytics-reader-password)" >/dev/null
  # LabFlow's login, in case the database was rebuilt since (restore-db.sh makes it after a restore).
  if [[ -n "$(sql "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name = N'LabFlow'" | tr -d '[:space:]')" ]]; then
    run_sql_file deploy/labflow/sql-login.sql \
      -v "LABFLOW_DB_PASSWORD=$(grep -E '^LABFLOW_DB_PASSWORD=' .env | cut -d= -f2-)" >/dev/null
  fi

  # RabbitMQ: the hub's account (from its configuration) with only what the hub uses, and Analytics' consumer.
  if docker compose ps --services --status running | grep -qx integrationhub-mq; then
    echo "==> RabbitMQ accounts"
    mq() { docker compose exec -T integrationhub-mq rabbitmqctl -q "$@"; }
    mq set_user_tags integrationhub
    mq set_permissions -p / integrationhub '^(clinical\.events|analytics\.clinical-events)$' '^(clinical\.events|analytics\.clinical-events)$' '^clinical\.events$'
    mq add_user analytics "$(secret analytics-rabbitmq-password)" 2>/dev/null \
      || mq change_password analytics "$(secret analytics-rabbitmq-password)"
    mq set_permissions -p / analytics '^analytics\.clinical-events$' '^analytics\.clinical-events$' '^(analytics\.clinical-events|clinical\.events)$'
  fi
fi

echo "Migrations done."
