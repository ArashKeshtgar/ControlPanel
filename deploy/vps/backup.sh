#!/usr/bin/env bash
# Nightly backup of everything that isn't in git: the four SQL Server
# databases, ReBiomed's MongoDB and its uploaded files. Keeps KEEP_DAYS days
# in /srv/backups/daily. Install for the deploy user with `crontab -e`:
#
#   30 3 * * * /srv/portfolio/ControlPanel/deploy/vps/backup.sh >> /srv/backups/backup.log 2>&1
#
# This protects against mistakes, not against losing the server: copy
# /srv/backups/daily somewhere else too (README.md, "Off-server copy").
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
BACKUPS="${BACKUP_DIR:-/srv/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUPS/daily/$STAMP"
DATABASES=(ControlPanelDb HisPlusDemo LedgerDashboard LabFlow)

cd "$CP"
mkdir -p "$OUT"
echo "[$(date -Is)] backup -> $OUT"

sql() {
  docker compose exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -h -1 -Q "$1"' _ "$1"
}

for db in "${DATABASES[@]}"; do
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

docker compose exec -T rebiomed-mongo mongodump --quiet --archive --gzip > "$OUT/rebiomed-mongo.archive.gz"
echo "  rebiomed mongo ok"

# Uploaded listing photos and verification documents, and the lessons'
# review progress + sync key (named volumes).
for vol in rebiomed-uploads rebiomed-private lessons-sync-data; do
  docker run --rm -v "controlpanel_$vol:/data:ro" -v "$OUT:/out" alpine \
    tar -czf "/out/$vol.tar.gz" -C /data .
  echo "  $vol ok"
done

find "$BACKUPS/daily" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[$(date -Is)] done ($(du -sh "$OUT" | cut -f1))"
