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
for f in 03-schema.sql 04-views.sql 06-report-views.sql; do
  echo "==> LedgerDashboard  $f"
  run_sql_file "$LD/$f" -d LedgerDashboard >/dev/null
done

echo "Migrations done."
