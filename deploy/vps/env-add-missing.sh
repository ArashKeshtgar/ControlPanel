#!/usr/bin/env bash
# Adds to the server's .env every setting that .env.vps.example has and the
# .env doesn't, so a release that needs a new setting deploys without a
# manual step. deploy.sh runs it before `docker compose up`.
#
#   deploy/vps/env-add-missing.sh
#
# An empty *_PASSWORD in the template gets a generated one (letters and
# digits, like make-env.sh, so it never needs quoting); a *_DOMAIN gets the
# template's subdomain on this server's domain (from PANEL_DOMAIN); any other
# key gets the template's value, empty or not. A key already in .env is never
# touched, even if empty. Prints the names it added, never the values.
set -euo pipefail

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
ENV="$CP/.env"
TEMPLATE="$CP/deploy/vps/.env.vps.example"
[[ -f "$ENV" ]] || { echo "No $ENV yet: run make-env.sh first." >&2; exit 1; }

rand() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
sqlpw() { printf '%s-Aa1' "$(rand 28)"; }

# panel.example.com in .env -> example.com
base_domain="$(grep -E '^PANEL_DOMAIN=' "$ENV" | tail -1 | cut -d= -f2- | sed -E 's/^panel\.//')"

added=()
while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  grep -qE "^$key=" "$ENV" && continue
  if [[ -z "$value" && "$key" == *_PASSWORD ]]; then value="$(sqlpw)"; fi
  if [[ "$key" == *_DOMAIN && -n "$base_domain" ]]; then value="${value%%.*}.$base_domain"; fi
  # A newline first in case the file doesn't end with one.
  [[ -s "$ENV" && "$(tail -c1 "$ENV")" != "" ]] && printf '\n' >> "$ENV"
  printf '%s=%s\n' "$key" "$value" >> "$ENV"
  added+=("$key")
done < "$TEMPLATE"

if [[ ${#added[@]} -gt 0 ]]; then
  echo "Added to .env: ${added[*]}"
fi
