#!/usr/bin/env bash
# Proves once a month that the off-server copy restores: checks the restic repository, restores the latest snapshot
# to a scratch folder, restores every SQL Server database from it under another name (RestoreTest_<name>), runs
# DBCC CHECKDB and drops it again, reads IntegrationHub's dump and every archive, and checks the secrets are there.
# Nothing in use is touched. Install for the deploy user with `crontab -e`:
#
#   0 5 1 * * /srv/portfolio/ControlPanel/deploy/vps/restore-test.sh >> /srv/backups/restore-test.log 2>&1
#
# A failure is reported to healthchecks.io (job restore-test) with the step that failed.
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
BACKUPS="${BACKUP_DIR:-/srv/backups}"
RESTIC_ENV="${RESTIC_ENV:-/srv/secrets/backup/restic.env}"
RESTIC_IMAGE="restic/restic:0.17.3"
# Under the folder SQL Server's container sees as /var/opt/mssql/backup.
WORK="$BACKUPS/mssql/restore-test"
INSIDE="/var/opt/mssql/backup/restore-test"

cd "$CP"
# shellcheck source=deploy/vps/notify.sh
source "$CP/deploy/vps/notify.sh"
step="start"
ping_check restore-test start
# restic writes as root, so the scratch folder is removed through a container too.
cleanup() { docker run --rm -v "$BACKUPS/mssql:/m" alpine rm -rf /m/restore-test; }
trap 'ping_check restore-test fail "restore-test.sh failed: $step (line $LINENO)"' ERR
trap cleanup EXIT

[[ -r "$RESTIC_ENV" ]] || { step="no $RESTIC_ENV"; false; }
echo "[$(date -Is)] restore test"

restic() {
  docker run --rm -i --env-file "$RESTIC_ENV" -v restic-cache:/root/.cache/restic -v "$WORK:/restore" "$RESTIC_IMAGE" "$@"
}
sql() {
  docker compose exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -h -1 -W -s "|" -Q "$1"' _ "$1"
}

step="repository check"
cleanup; mkdir -p "$WORK"
# A tenth of the data is downloaded and its checksums verified each month: all of it over about a year.
restic check --read-data-subset=10% >/dev/null
echo "  repository ok"

step="restore of the latest snapshot"
restic restore latest --tag nightly --target /restore >/dev/null
# restic writes as root; SQL Server (uid 10001) only needs to read.
docker run --rm -v "$WORK:/restore" alpine chmod -R a+rX /restore
DAILY="$WORK/backup/daily"
[[ -d "$DAILY" ]] || { step="no daily folder in the snapshot"; false; }
echo "  restored $(du -sh "$DAILY" | cut -f1)"

restored=0
for gz in "$DAILY"/*.bak.gz; do
  [[ -e "$gz" ]] || continue
  db="$(basename "$gz" .bak.gz)"
  test_db="RestoreTest_$db"
  step="restore of $db"
  gunzip -c "$gz" > "$WORK/$db.bak"
  chmod a+r "$WORK/$db.bak"
  moves="" n=0
  while IFS='|' read -r logical _ type _; do
    [[ -z "$logical" || -z "$type" ]] && continue
    case "$type" in L) ext=ldf ;; *) ext=mdf ;; esac
    [[ $n -gt 0 && "$ext" == mdf ]] && ext=ndf
    moves+=", MOVE N'$logical' TO N'/var/opt/mssql/data/${test_db}_$n.$ext'"
    n=$((n + 1))
  done < <(sql "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$INSIDE/$db.bak'")
  sql "IF DB_ID(N'$test_db') IS NOT NULL DROP DATABASE [$test_db];
       RESTORE DATABASE [$test_db] FROM DISK = N'$INSIDE/$db.bak' WITH RECOVERY, CHECKSUM$moves;" >/dev/null
  step="DBCC CHECKDB of $db"
  sql "DBCC CHECKDB (N'$test_db') WITH NO_INFOMSGS, ALL_ERRORMSGS;" >/dev/null
  tables="$(sql "SET NOCOUNT ON; SELECT COUNT(*) FROM [$test_db].sys.tables" | tr -d '[:space:]')"
  sql "ALTER DATABASE [$test_db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$test_db];" >/dev/null
  rm -f "$WORK/$db.bak"
  echo "  $db ok ($tables tables)"
  restored=$((restored + 1))
done
[[ $restored -gt 0 ]] || { step="no database in the snapshot"; false; }

if [[ -e "$DAILY/integrationhub.pgdump" ]]; then
  step="IntegrationHub's dump"
  docker compose exec -T integrationhub-db pg_restore --list < "$DAILY/integrationhub.pgdump" >/dev/null
  echo "  integrationhub postgres ok"
fi

for archive in "$DAILY"/*.tar.gz "$DAILY"/*.archive.gz; do
  [[ -e "$archive" ]] || continue
  step="archive $(basename "$archive")"
  gzip -t "$archive"
done
echo "  archives ok"

if [[ -d "$WORK/backup/secrets/clinic" ]]; then
  step="clinic secrets"
  for f in clinichub-signing.pfx clinichub-signing-password clinichub-db-password; do
    [[ -s "$WORK/backup/secrets/clinic/$f" ]] || { step="clinic secret $f missing"; false; }
  done
  echo "  clinic secrets ok"
fi

trap - ERR
summary="$restored databases restored and checked, $(du -sh "$DAILY" | cut -f1)"
echo "[$(date -Is)] done: $summary"
ping_check restore-test ok "$summary"
