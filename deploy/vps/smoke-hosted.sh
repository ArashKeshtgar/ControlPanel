#!/usr/bin/env bash
# The hosted ClinicReport from outside, through Caddy and real TLS: sign a clinic up, sign in, start a report, remove it
# again, then read the tenants' health. Always the same clinic (smoke-test), so that a release spends no new certificate.
# Called by release.ps1 when compose.hosted.yml is in use; synthetic data only. Exits non-zero at the first failure.
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
cd "$CP"
HOSTED_DOMAIN="$(grep -E '^HOSTED_DOMAIN=' .env | cut -d= -f2-)"
SLUG=smoke-test
BASE="https://$SLUG.$HOSTED_DOMAIN"
EMAIL="smoke@$SLUG.example.com"
PASSWORD="smoke-$(openssl rand -hex 12)"
TOKEN="$(cat "${HOSTED_SECRETS_DIR:-/srv/secrets/hosted}/health-token")"
JAR="$(mktemp)"

# Through Caddy's container, as these addresses aren't served to the outside.
internal() { docker compose exec -T caddy wget -q -O - --header "X-Health-Token: $TOKEN" "$@" "http://clinicreport-hosted:8080$PATH_IN"; }
remove() { PATH_IN=/healthz/smoke-tenant/remove internal --post-data= >/dev/null; }
cleanup() { rm -f "$JAR"; remove || echo "  could not remove $SLUG" >&2; }

# A failed run earlier may have left it.
remove
trap cleanup EXIT

api() { curl -sS -m 30 -b "$JAR" -c "$JAR" -H 'X-ClinicReport: 1' -H 'Content-Type: application/json' "$@"; }
expect() { [[ "$2" == "$3" ]] && echo "  $1 $2 ok" || { echo "  $1: $2, expected $3" >&2; exit 1; }; }

code="$(api -o /dev/null -w '%{http_code}' -X POST "https://$HOSTED_DOMAIN/api/signup" \
  -d "{\"clinicName\":\"Smoke Test\",\"slug\":\"$SLUG\",\"adminName\":\"Smoke Owner\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
expect signup "$code" 201

# The first visit to the address fetches its certificate.
for _ in {1..20}; do curl -s -o /dev/null -m 10 "$BASE/healthz" && break; sleep 3; done
code="$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -d "{\"userName\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
expect login "$code" 200

template="$(api "$BASE/api/templates" | python3 -c 'import json,sys; print(next(t["id"] for t in json.load(sys.stdin) if t["key"] == "echo-tte"))')"
patient="$(api -X POST "$BASE/api/patients" -d '{"mrn":"SMOKE-0001","firstName":"Smoke","lastName":"Test","dateOfBirth":"1980-01-01","sex":"U"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
code="$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/reports" -d "{\"patientId\":$patient,\"templateId\":$template,\"examDate\":\"2026-01-01\"}")"
expect "start report" "$code" 201

code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://$HOSTED_DOMAIN/healthz/tenants")"
expect "health hidden from outside" "$code" 404

health="$(PATH_IN=/healthz/tenants internal)"
echo "  tenants: $health"
failed="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["databaseFailed"])' "$health")"
expect "databases failing" "$failed" 0
