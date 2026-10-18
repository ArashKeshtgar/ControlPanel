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
LEDGERDASH_ADAPTER="${LEDGERDASH_ADAPTER:-ledgerdash-adapter:4006}"
REBIOMED_ADAPTER="${REBIOMED_ADAPTER:-rebiomed-adapter:4010}"
LESSONS_ADAPTER="${LESSONS_ADAPTER:-lessons-adapter:4011}"
CLINICHUB_ADAPTER="${CLINICHUB_ADAPTER:-clinichub-adapter:4012}"
LABFLOW_ADAPTER="${LABFLOW_ADAPTER:-labflow-adapter:4013}"
CLINICREPORT_ADAPTER="${CLINICREPORT_ADAPTER:-clinicreport-adapter:4014}"
PHARMAFLOW_ADAPTER="${PHARMAFLOW_ADAPTER:-pharmaflow-adapter:4015}"
FINANCE_ADAPTER="${FINANCE_ADAPTER:-finance-adapter:4016}"

for script in /db/*.sql; do
  echo "Running $(basename "$script")"
  "$SQLCMD" -C -b -S sqlserver -U sa -P "$SA_PASSWORD" -i "$script" \
    -v DB_PASSWORD="$DB_PASSWORD" \
    -v ADAPTER_HOST="$ADAPTER_HOST" \
    -v WUTILITY_ADAPTER="$WUTILITY_ADAPTER" \
    -v HISPLUS_ADAPTER="$HISPLUS_ADAPTER" \
    -v LEDGERDASH_ADAPTER="$LEDGERDASH_ADAPTER" \
    -v REBIOMED_ADAPTER="$REBIOMED_ADAPTER" \
    -v LESSONS_ADAPTER="$LESSONS_ADAPTER" \
    -v CLINICHUB_ADAPTER="$CLINICHUB_ADAPTER" \
    -v LABFLOW_ADAPTER="$LABFLOW_ADAPTER" \
    -v CLINICREPORT_ADAPTER="$CLINICREPORT_ADAPTER" \
    -v PHARMAFLOW_ADAPTER="$PHARMAFLOW_ADAPTER" \
    -v FINANCE_ADAPTER="$FINANCE_ADAPTER"
done
echo "Database initialization complete."
