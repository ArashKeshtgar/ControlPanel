#!/usr/bin/env bash
# Every five minutes: is everything on this server well? Reports to healthchecks.io (job watchdog): "ok", or "fail"
# with what is wrong. healthchecks.io alerts on a failure and, because it expects a ping every five minutes, also
# when the pings stop: the server down, Docker stopped, the network gone. Install for the deploy user:
#
#   */5 * * * * /srv/portfolio/ControlPanel/deploy/vps/watchdog.sh >> /srv/backups/watchdog.log 2>&1
#
# In healthchecks.io, give the check "watchdog" a period of 5 minutes and a grace time of 10 (README.md, "Monitoring").
# Checked:
#   - every container: running, not restarting, healthy where it has a health check (one-shot jobs that exited 0 are fine)
#   - disk use on / under DISK_LIMIT %, memory available over MEM_MIN_MB
#   - every site's certificate valid for at least CERT_DAYS more days (Caddy renews at 30: still under 14 means it can't)
#   - a local backup from the last 26 hours
set -uo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
BACKUPS="${BACKUP_DIR:-/srv/backups}"
DISK_LIMIT="${DISK_LIMIT:-85}"
MEM_MIN_MB="${MEM_MIN_MB:-300}"
CERT_DAYS="${CERT_DAYS:-14}"

cd "$CP" || exit 1
# shellcheck source=deploy/vps/notify.sh
source "$CP/deploy/vps/notify.sh"
problems=()

# ---- containers
while IFS='|' read -r service state health code; do
  [[ -z "$service" ]] && continue
  case "$state" in
    running) [[ "$health" == unhealthy ]] && problems+=("$service is unhealthy") ;;
    exited) [[ "$code" != 0 ]] && problems+=("$service exited with code $code") ;;
    created) ;;
    *) problems+=("$service is $state") ;;
  esac
done < <(docker compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>&1 || echo "docker|unreachable||")
running="$(docker compose ps --services --status running 2>/dev/null | wc -l)"

# ---- disk and memory
disk="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
(( disk >= DISK_LIMIT )) && problems+=("disk / is ${disk}% full")
mem="$(awk '/MemAvailable/ { print int($2 / 1024) }' /proc/meminfo)"
(( mem < MEM_MIN_MB )) && problems+=("only ${mem} MB of memory available")

# ---- certificates: every *_DOMAIN in .env, and the clinic platform's names
mapfile -t domains < <(grep -E '^[A-Z_]+_DOMAIN=' .env | grep -v '^CLINIC_DOMAIN=' | cut -d= -f2- | tr -d "'\"" | sed '/^$/d')
clinic="$(grep -E '^CLINIC_DOMAIN=' .env | cut -d= -f2- | tr -d "'\"")"
if [[ -n "$clinic" ]] && grep -qE '^COMPOSE_FILE=.*compose\.clinic\.yml' .env; then
  for name in hub report lab pharmacy finance analytics integration; do domains+=("$name.$clinic"); done
fi
now="$(date +%s)"
for d in "${domains[@]}"; do
  end="$(echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$d" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -z "$end" ]]; then problems+=("no certificate for $d"); continue; fi
  days=$(( ($(date -d "$end" +%s) - now) / 86400 ))
  (( days < CERT_DAYS )) && problems+=("certificate of $d ends in $days days")
done

# ---- last local backup
latest="$(find "$BACKUPS/daily" -mindepth 1 -maxdepth 1 -type d -mmin -$((26 * 60)) 2>/dev/null | head -1)"
[[ -n "$latest" ]] || problems+=("no backup in $BACKUPS/daily from the last 26 hours")

if [[ ${#problems[@]} -gt 0 ]]; then
  message="$(printf '%s\n' "${problems[@]}")"
  echo "[$(date -Is)] $(tr '\n' ';' <<<"$message")"
  ping_check watchdog fail "$message"
else
  ping_check watchdog ok "$running containers running, disk ${disk}%, ${mem} MB free, ${#domains[@]} certificates"
fi
