#!/usr/bin/env bash
# Nightly backup of everything that isn't in git: the SQL Server databases (the portfolio's, and with the clinic
# platform ClinicHub's catalog and clinics, PharmaFlow and FinancePowerApp), ReBiomed's MongoDB and its uploaded files,
# IntegrationHub's PostgreSQL and the volumes that hold keys or history. Keeps KEEP_DAYS days in /srv/backups/daily,
# then sends the night's folder and the clinic secrets off the server, encrypted (backup-offsite.sh). Install for the
# deploy user with `crontab -e`:
#
#   30 3 * * * /srv/portfolio/ControlPanel/deploy/vps/backup.sh >> /srv/backups/backup.log 2>&1
#
# The local copy protects against mistakes; only the off-server copy survives losing the server.
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
BACKUPS="${BACKUP_DIR:-/srv/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUPS/daily/$STAMP"
DATABASES=(ControlPanelDb HisPlusDemo LedgerDashboard LabFlow PharmaFlow FinancePowerApp)
# Named volumes are <project>_<name>; the project is the folder's name unless .env says otherwise.
PROJECT="$(grep -E '^COMPOSE_PROJECT_NAME=' "$CP/.env" 2>/dev/null | cut -d= -f2- || true)"
PROJECT="${PROJECT:-controlpanel}"

cd "$CP"
# shellcheck source=deploy/vps/notify.sh
source "$CP/deploy/vps/notify.sh"
ping_check backup start
trap 'ping_check backup fail "backup.sh failed at line $LINENO"' ERR

mkdir -p "$OUT"
echo "[$(date -Is)] backup -> $OUT"

sql() {
  docker compose exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -h -1 -Q "$1"' _ "$1"
}

# ClinicHub makes one database per clinic (ClinicHub_<slug>) besides its catalog: whatever is there tonight.
mapfile -t clinic_dbs < <(sql "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name LIKE N'ClinicHub[_]%' ORDER BY name" | tr -d '\r' | sed '/^\s*$/d')
for db in "${DATABASES[@]}" "${clinic_dbs[@]}"; do
  db="$(tr -d '[:space:]' <<<"$db")"
  if [[ -z "$(sql "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name = N'$db'" | tr -d '[:space:]')" ]]; then
    echo "  skip $db (not on this server)"
    continue
  fi
  # Express can't compress backups; gzip does it afterwards.
  sql "BACKUP DATABASE [$db] TO DISK = N'/var/opt/mssql/backup/$db.bak' WITH INIT, COPY_ONLY, CHECKSUM" >/dev/null
  # Read it through the container: the file belongs to mssql (uid 10001).
  docker compose exec -T sqlserver cat "/var/opt/mssql/backup/$db.bak" | gzip > "$OUT/$db.bak.gz"
  docker compose exec -T sqlserver rm -f "/var/opt/mssql/backup/$db.bak"
  echo "  $db ok"
done

running="$(docker compose ps --services --status running)"

if grep -qx rebiomed-mongo <<<"$running"; then
  docker compose exec -T rebiomed-mongo mongodump --quiet --archive --gzip > "$OUT/rebiomed-mongo.archive.gz"
  echo "  rebiomed mongo ok"
fi

# IntegrationHub's message log (metadata only) and its HL7 queues (encrypted with the queue key).
if grep -qx integrationhub-db <<<"$running"; then
  docker compose exec -T integrationhub-db pg_dump -U integrationhub --format=custom integrationhub > "$OUT/integrationhub.pgdump"
  echo "  integrationhub postgres ok"
fi

# Named volumes: uploaded listing photos and verification documents, the lessons' review progress and sync key;
# ClinicHub's Data Protection keys (without them two-factor secrets and clinic connection strings can't be read),
# the connected ClinicReport's databases, and Analytics' warehouse and finance extracts (its open-item history).
for vol in rebiomed-uploads rebiomed-private lessons-sync-data clinichub-keys clinicreport-clinic-data analytics-data; do
  docker volume inspect "${PROJECT}_$vol" >/dev/null 2>&1 || continue
  docker run --rm -v "${PROJECT}_$vol:/data:ro" -v "$OUT:/out" alpine \
    tar -czf "/out/$vol.tar.gz" -C /data .
  echo "  $vol ok"
done

find "$BACKUPS/daily" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[$(date -Is)] local copy done ($(du -sh "$OUT" | cut -f1))"

# Off the server: tonight's folder and the secrets, encrypted (nothing configured: says so and stops here).
"$CP/deploy/vps/backup-offsite.sh" "$OUT"

trap - ERR
ping_check backup ok "$(du -sh "$OUT" | cut -f1) in $OUT"
