#!/usr/bin/env bash
# Generates the clinic platform's secrets on the server, one file per secret, the way compose.clinic.yml hands them
# to the containers (Docker secrets: /run/secrets/<setting> inside each one). Nothing is in .env or in git, and
# nothing leaves the server:
#
#   deploy/vps/make-clinic-secrets.sh
#
#   /srv/secrets/clinic/         (CLINIC_SECRETS_DIR) mode 700, owned by deploy; each file mode 444 so the containers'
#                                own users can read their mounts, while the folder keeps everyone else on the host out
#
# Creates only what is missing, so running it again after an upgrade adds the new secrets and changes no existing
# one. To rotate one: delete its file, run this again, then `deploy/vps/migrate.sh` (database passwords) and
# `docker compose up -d` (everything else). backup.sh copies this folder into the encrypted off-server backup.
set -euo pipefail

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
DIR="${CLINIC_SECRETS_DIR:-/srv/secrets/clinic}"

# Letters and digits only: nothing to quote in a connection string, a sqlcmd -v or an AMQP URL. -Aa1 meets SQL
# Server's password policy whatever the random part is.
rand() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
sqlpw() { printf '%s-Aa1' "$(rand 28)"; }
env_val() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -E "s/^['\"](.*)['\"]$/\1/"; }

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
made=()

# put <name> <value>: written without a trailing newline (the applications take a file's content as the value).
put() {
  local f="$DIR/$1"
  [[ -e "$f" ]] && return 0
  printf '%s' "$2" > "$f.tmp"
  chmod 444 "$f.tmp"
  mv "$f.tmp" "$f"
  made+=("$1")
}
get() { cat "$DIR/$1"; }

sql_cs() { printf 'Server=sqlserver,1433;Database=%s;User Id=%s;Password=%s;TrustServerCertificate=True;Encrypt=True' "$1" "$2" "$3"; }

# ---- SQL Server logins (deploy/clinic/sql-logins.sql) and the connection strings built from them
put clinichub-db-password "$(sqlpw)"
put clinichub-catalog-connection "$(sql_cs ClinicHub_Catalog clinichub_svc "$(get clinichub-db-password)")"
put clinichub-server-connection "$(printf 'Server=sqlserver,1433;User Id=clinichub_svc;Password=%s;TrustServerCertificate=True;Encrypt=True' "$(get clinichub-db-password)")"
put pharmaflow-db-password "$(sqlpw)"
put pharmaflow-connection "$(sql_cs PharmaFlow pharmaflow_svc "$(get pharmaflow-db-password)")"
put finance-db-password "$(sqlpw)"
put finance-connection "$(sql_cs FinancePowerApp finance_svc "$(get finance-db-password)")"
# Analytics' read-only login on the books (FinancePowerApp's database/tools/analytics_reader.sql).
put analytics-reader-password "$(sqlpw)"
put analytics-finance-connection "$(printf 'DRIVER={ODBC Driver 18 for SQL Server};SERVER=sqlserver,1433;DATABASE=FinancePowerApp;UID=analytics_reader;PWD=%s;TrustServerCertificate=yes;Encrypt=yes' "$(get analytics-reader-password)")"
# LabFlow keeps the password restore-db.sh already uses (LABFLOW_DB_PASSWORD in .env): only its connection string is here.
if [[ -f "$CP/.env" ]] && labflow_pw="$(env_val LABFLOW_DB_PASSWORD "$CP/.env")" && [[ -n "$labflow_pw" ]]; then
  put labflow-connection "$(sql_cs LabFlow labflow_svc "$labflow_pw")"
else
  [[ -e "$DIR/labflow-connection" ]] || { echo "LABFLOW_DB_PASSWORD is not in $CP/.env: run make-env.sh first." >&2; exit 1; }
fi

# ---- ClinicHub's applications: the same secret in ClinicHub (Sso:Clients) and in the application (ClinicHub:ClientSecret)
for client in clinicreport labflow pharmaflow finance integrationhub; do
  put "$client-client-secret" "$(rand 48)"
done

# ---- ClinicHub's token signing certificate (OpenIddict): signs and encrypts with the same key. Five years; to
# rotate, delete both files and run this again (people sign in again; applications fetch the new keys themselves).
if [[ ! -e "$DIR/clinichub-signing.pfx" ]]; then
  put clinichub-signing-password "$(rand 32)"
  work="$(mktemp -d)"
  openssl req -x509 -newkey rsa:3072 -sha256 -days 1826 -nodes -subj "/CN=ClinicHub token signing" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -out "$DIR/clinichub-signing.pfx" \
    -passout "pass:$(get clinichub-signing-password)"
  rm -rf "$work"
  chmod 444 "$DIR/clinichub-signing.pfx"
  made+=(clinichub-signing.pfx)
fi

# ---- IntegrationHub: its PostgreSQL, RabbitMQ (its own account, and one for Analytics' consumer) and the events' pseudonyms
put hub-db-password "$(rand 40)"
put hub-rabbitmq-password "$(rand 40)"
put analytics-rabbitmq-password "$(rand 40)"
put analytics-rabbitmq-url "amqp://analytics:$(get analytics-rabbitmq-password)@integrationhub-mq:5672/"
put hub-events-pseudonym-secret "$(rand 64)"
# RabbitMQ's first account comes from its configuration (mounted into conf.d); there is no guest outside localhost.
put rabbitmq-defaults.conf "$(printf 'default_user = integrationhub\ndefault_pass = %s\nloopback_users.guest = true\n' "$(get hub-rabbitmq-password)")"

if [[ ${#made[@]} -eq 0 ]]; then
  echo "Nothing new: every clinic secret is already in $DIR."
else
  echo "Written to $DIR:"
  printf '  %s\n' "${made[@]}"
fi
