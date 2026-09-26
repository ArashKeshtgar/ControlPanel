#!/bin/bash
# Runs every db/*.sql script in order against the SQL Server container.
# Used by the db-init service in docker-compose.yml; see README.md for the
# equivalent sqlcmd commands against a local SQL Server.
set -euo pipefail

SQLCMD=/opt/mssql-tools18/bin/sqlcmd
: "${SA_PASSWORD:?SA_PASSWORD is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

ADAPTER_HOST="${ADAPTER_HOST:-localhost}"
WUTILITY_ADAPTER="${WUTILITY_ADAPTER:-wutility-adapter:4001}"
HISPLUS_ADAPTER="${HISPLUS_ADAPTER:-hisplus-adapter:4002}"

for script in /db/*.sql; do
  echo "Running $(basename "$script")"
  "$SQLCMD" -C -b -S sqlserver -U sa -P "$SA_PASSWORD" -i "$script" \
    -v DB_PASSWORD="$DB_PASSWORD" \
    -v ADAPTER_HOST="$ADAPTER_HOST" \
    -v WUTILITY_ADAPTER="$WUTILITY_ADAPTER" \
    -v HISPLUS_ADAPTER="$HISPLUS_ADAPTER"
done
echo "Database initialization complete."
