#!/usr/bin/env bash
# Writes the server's two secret files from the templates, generating every
# password and secret on the server itself (nothing to copy, nothing leaves
# it):
#
#   deploy/vps/make-env.sh <domain> <email>
#   deploy/vps/make-env.sh arashkeshtgar.ca you@example.com
#
#   ControlPanel/.env                 from deploy/vps/.env.vps.example
#   LedgerDashboard/server/.env       LedgerDashboard's own settings
#
# Sites become panel.<domain>, rebiomed.<domain>, english.<domain>, report.<domain>,
# labflow.<domain> and ledger.<domain>. It asks once for the basic-auth password (LabFlow and
# LedgerDashboard) and prints the logins you'll need; nothing else is shown.
# Refuses to overwrite an existing file.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <domain> <email>" >&2; exit 1; }
DOMAIN="$1"; EMAIL="$2"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Odd domain: $DOMAIN" >&2; exit 1; }
[[ "$EMAIL" == *@*.* ]] || { echo "Odd email: $EMAIL" >&2; exit 1; }

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
ENV="$CP/.env"
LD_ENV="$ROOT/LedgerDashboard/server/.env"
for f in "$ENV" "$LD_ENV"; do
  [[ -e "$f" ]] && { echo "$f already exists; not touching it." >&2; exit 1; }
done
[[ -d "$ROOT/LedgerDashboard/server" ]] || { echo "Clone LedgerDashboard into $ROOT first." >&2; exit 1; }

# Letters and digits only, so no value ever needs quoting in .env, sqlcmd
# -v or a connection string. The -Aa1 suffix satisfies SQL Server's
# password policy (three character classes) whatever the random part is.
rand() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
sqlpw() { printf '%s-Aa1' "$(rand 28)"; }

read -r -s -p "Basic-auth password for labflow/ledger (12+ chars): " BA1; echo
read -r -s -p "Again: " BA2; echo
[[ "$BA1" == "$BA2" ]] || { echo "They differ." >&2; exit 1; }
[[ ${#BA1} -ge 12 ]] || { echo "Too short." >&2; exit 1; }
# Nothing is echoed, so a non-Latin keyboard layout goes unnoticed here and
# the password then never matches in the browser.
[[ "$BA1" == "$(printf '%s' "$BA1" | LC_ALL=C tr -cd ' -~')" ]]   || { echo "Only English letters, digits and symbols (check the keyboard layout)." >&2; exit 1; }
# Through stdin, so the password never appears in a process list.
BA_HASH="$(printf '%s\n' "$BA1" | docker run --rm -i caddy:2 caddy hash-password)"
unset BA1 BA2
[[ "$BA_HASH" == \$2* ]] || { echo "Hashing failed." >&2; exit 1; }

ADMIN_PW="$(rand 20)"
VIEWER_PW="$(rand 20)"
LEDGER_LOGIN_PW="$(rand 20)"

declare -A V=(
  [ACME_EMAIL]="$EMAIL"
  [PANEL_DOMAIN]="panel.$DOMAIN"
  [REBIOMED_DOMAIN]="rebiomed.$DOMAIN"
  [LABFLOW_DOMAIN]="labflow.$DOMAIN"
  [LEDGER_DOMAIN]="ledger.$DOMAIN"
  [LESSONS_DOMAIN]="english.$DOMAIN"
  [CONTEXT_DOMAIN]="ctx.$DOMAIN"
  [CLINICREPORT_DOMAIN]="report.$DOMAIN"
  [BASIC_AUTH_HASH]="'$BA_HASH'"
  [SA_PASSWORD]="$(sqlpw)"
  [DB_PASSWORD]="$(sqlpw)"
  [JWT_SECRET]="$(rand 64)"
  [JWT_REFRESH_SECRET]="$(rand 64)"
  [ADMIN_PASSWORD]="$ADMIN_PW"
  [VIEWER_PASSWORD]="$VIEWER_PW"
  [LEDGER_READER_PASSWORD]="$(sqlpw)"
  [LEDGERDASH_PASSWORD]="$LEDGER_LOGIN_PW"
  [LEDGERDASH_SESSION_SECRET]="$(rand 64)"
  [LEDGERDASH_API_TOKEN]="$(rand 64)"
  [REBIOMED_JWT_SECRET]="$(rand 64)"
  [LABFLOW_DB_PASSWORD]="$(sqlpw)"
)

umask 077
tmp="$(mktemp "$CP/.env.XXXX")"
while IFS= read -r line; do
  key="${line%%=*}"
  if [[ "$line" =~ ^[A-Z_]+= && -n "${V[$key]+x}" ]]; then
    printf '%s=%s\n' "$key" "${V[$key]}"
  else
    printf '%s\n' "$line"
  fi
done < "$CP/deploy/vps/.env.vps.example" > "$tmp"
mv "$tmp" "$ENV"

cat > "$LD_ENV" <<EOF
STORE=sql
DB_NAME=LedgerDashboard
DB_USER=ledger_svc
DB_PASSWORD=$(sqlpw)
# Optional: the dashboard's AI features.
ANTHROPIC_API_KEY=
EOF
chmod 600 "$ENV" "$LD_ENV"

cat <<EOF

Written: $ENV
         $LD_ENV   (both mode 600)

Save these in your password manager now; they aren't shown again (they're
in the files above if you ever need them):

  Control Panel   https://panel.$DOMAIN      admin  / $ADMIN_PW
                                                  viewer / $VIEWER_PW
  LedgerDashboard https://ledger.$DOMAIN     password: $LEDGER_LOGIN_PW
  LabFlow + Ledger + ctx basic auth               user: arash, the password you typed

Optional, fill in by hand if you want them:
  ANTHROPIC_API_KEY (both files), REBIOMED_STRIPE_* (test keys)
EOF
