#!/usr/bin/env bash
# Restores SQL Server .bak files into the container SQL Server, then
# recreates the app logins and maps them to the restored database users.
#
#   deploy/vps/restore-db.sh                       # every /srv/backups/import/*.bak
#   deploy/vps/restore-db.sh LedgerDashboard.bak   # just one
#
# The database name is the file name (LedgerDashboard.bak -> LedgerDashboard;
# a nightly LedgerDashboard.bak.gz from backup.sh is unzipped first).
# An existing database of that name is REPLACED.
#
# Logins live in master, not in the database, so a restored database's users
# are orphans. They're dropped and recreated by each app's own login script:
#   LedgerDashboard: ledger_svc (password = DB_PASSWORD in LedgerDashboard/server/.env)
#                    ledger_reader (LEDGER_READER_PASSWORD in this repo's .env)
#   LabFlow:         labflow_svc (LABFLOW_DB_PASSWORD in this repo's .env)
#                    labflow_reader (LABFLOW_READER_PASSWORD in this repo's .env)
#   FinancePowerApp: finance_svc, finance_reader (FINANCE_*_PASSWORD)
#   PharmaFlow:      pharmaflow_svc (PHARMAFLOW_DB_PASSWORD)
#   ClinicHub_*:     owned by clinichub_svc, which created them (app-db-init
#                    makes the login; the owner is set back to it here)
# (The last two are normally created from scripts by app-db-init, not
# restored; this is for bringing back a nightly backup.)
set -euo pipefail

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
BACKUPS="${BACKUP_DIR:-/srv/backups}"
cd "$CP"

# Value of KEY in an env file, without surrounding quotes.
env_val() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -E "s/^['\"](.*)['\"]$/\1/"; }

sql() {
  docker compose exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -h -1 -W -s "|" -Q "$1"' _ "$1"
}

# run_sql_file <script> [-v NAME=value ...]
run_sql_file() {
  local file="$1"; shift
  # Through stdin, so the temp file belongs to mssql and it can delete it.
  docker compose exec -T sqlserver bash -c \
    'f=$(mktemp); cat > "$f"; /opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -i "$f" "$@"; rc=$?; rm -f "$f"; exit $rc' _ "$@" < "$file"
}

restore_one() {
  local src="$1" db tmp
  db="$(basename "$src")"; db="${db%.gz}"; db="${db%.bak}"
  [[ "$db" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Odd database name '$db', skipping."; return 1; }
  echo "==> $db  <- $src"

  tmp="$BACKUPS/mssql/restore-$db.bak"
  if [[ "$src" == *.gz ]]; then gunzip -c "$src" > "$tmp"; else cp "$src" "$tmp"; fi
  chmod 644 "$tmp"
  local inside="/var/opt/mssql/backup/restore-$db.bak"

  # One MOVE per file in the backup: Windows paths mean nothing here.
  local moves="" n=0 logical type ext
  while IFS='|' read -r logical _ type _; do
    [[ -z "$logical" || -z "$type" ]] && continue
    case "$type" in L) ext=ldf ;; *) ext=mdf ;; esac
    [[ $n -gt 0 && "$ext" == mdf ]] && ext=ndf
    moves+=", MOVE N'$logical' TO N'/var/opt/mssql/data/${db}_$n.$ext'"
    n=$((n + 1))
  done < <(sql "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$inside'")
  [[ $n -gt 0 ]] || { echo "No files listed in the backup."; return 1; }

  sql "IF DB_ID(N'$db') IS NOT NULL ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
       RESTORE DATABASE [$db] FROM DISK = N'$inside' WITH REPLACE, RECOVERY$moves;
       ALTER DATABASE [$db] SET MULTI_USER;" >/dev/null
  rm -f "$tmp"

  case "$db" in
    LedgerDashboard)
      local ld="$ROOT/LedgerDashboard"
      sql "USE [LedgerDashboard]; DROP USER IF EXISTS ledger_svc; DROP USER IF EXISTS ledger_reader;" >/dev/null
      run_sql_file "$ld/db/02-service-login.sql" -v "DB_PASSWORD=$(env_val DB_PASSWORD "$ld/server/.env")"
      run_sql_file "$ld/db/05-reader-login.sql" -v "READER_PASSWORD=$(env_val LEDGER_READER_PASSWORD .env)"
      ;;
    LabFlow)
      sql "USE [LabFlow]; DROP USER IF EXISTS labflow_svc; DROP USER IF EXISTS labflow_reader;" >/dev/null
      run_sql_file deploy/labflow/sql-login.sql -v "LABFLOW_DB_PASSWORD=$(env_val LABFLOW_DB_PASSWORD .env)"
      run_sql_file deploy/labflow/reader-login.sql -v "LABFLOW_READER_PASSWORD=$(env_val LABFLOW_READER_PASSWORD .env)"
      ;;
    FinancePowerApp)
      sql "USE [FinancePowerApp]; DROP USER IF EXISTS finance_svc; DROP USER IF EXISTS finance_reader;" >/dev/null
      run_sql_file deploy/finance/sql-login.sql \
        -v "FINANCE_DB_PASSWORD=$(env_val FINANCE_DB_PASSWORD .env)" "FINANCE_READER_PASSWORD=$(env_val FINANCE_READER_PASSWORD .env)"
      ;;
    ClinicHub_*)
      sql "ALTER AUTHORIZATION ON DATABASE::[$db] TO clinichub_svc;" >/dev/null
      ;;
    PharmaFlow)
      sql "USE [PharmaFlow]; DROP USER IF EXISTS pharmaflow_svc;" >/dev/null
      run_sql_file deploy/pharmaflow/sql-login.sql -v "PHARMAFLOW_DB_PASSWORD=$(env_val PHARMAFLOW_DB_PASSWORD .env)"
      ;;
  esac
  echo "    restored"
}

if [[ $# -gt 0 ]]; then files=("$@"); else
  shopt -s nullglob
  files=("$BACKUPS"/import/*.bak "$BACKUPS"/import/*.bak.gz)
fi
[[ ${#files[@]} -gt 0 ]] || { echo "Nothing to restore in $BACKUPS/import/."; exit 1; }

for f in "${files[@]}"; do restore_one "$f"; done

# Whatever was connected to the old copies reconnects to the new ones.
running="$(docker compose ps --services --status running)"
for svc in ledgerdashboard ledgerdash-adapter labflow-api labflow-adapter finance-api finance-adapter pharmaflow-api clinichub; do
  if grep -qx "$svc" <<<"$running"; then docker compose restart "$svc"; fi
done
echo "Done."
