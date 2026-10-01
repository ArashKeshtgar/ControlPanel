#!/usr/bin/env bash
# Pulls every repo the stack builds from, then rebuilds and restarts what
# changed. Run as deploy on the server, by hand or from the GitHub Action
# (.github/workflows/deploy-vps.yml):
#
#   /srv/portfolio/ControlPanel/deploy/vps/deploy.sh
#
# The first run also clones the repos. Repos are public, so plain HTTPS.
set -euo pipefail

ROOT="${PORTFOLIO_ROOT:-/srv/portfolio}"
CP="$ROOT/ControlPanel"
# folder -> clone URL. LabFlow's URL comes from .env until it has a GitHub repo.
declare -A REPOS=(
  [ControlPanel]=https://github.com/ArashKeshtgar/ControlPanel.git
  [LedgerDashboard]=https://github.com/ArashKeshtgar/LedgerDashboard.git
  [Rebiomed]=https://github.com/ArashKeshtgar/Rebiomed.git
  [LanguageLessonDesigner]=https://github.com/ArashKeshtgar/LanguageLessonDesigner.git
)
LABFLOW_REPO="$(grep -E '^LABFLOW_REPO=' "$CP/.env" 2>/dev/null | cut -d= -f2- || true)"
[[ -n "$LABFLOW_REPO" ]] && REPOS[LabFlow]="$LABFLOW_REPO"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# One deploy at a time (a push during a running deploy waits).
exec 9>/tmp/portfolio-deploy.lock
flock 9

for name in "${!REPOS[@]}"; do
  dir="$ROOT/$name"
  if [[ -d "$dir/.git" ]]; then
    log "Pull $name"
    # --ff-only: a server copy never has its own commits; if it somehow
    # does, stop rather than merge.
    git -C "$dir" pull --ff-only
  else
    log "Clone $name"
    git clone "${REPOS[$name]}" "$dir"
  fi
done

[[ -f "$CP/.env" ]] || { echo "Missing $CP/.env (copy deploy/vps/.env.vps.example)."; exit 1; }

cd "$CP"
log "Build and start"
docker compose up -d --build --remove-orphans

# Not `up --wait`: it also waits on the one-shot db-init/seed-users and
# counts their normal exit as a failure on some Compose versions.
log "Wait for health checks"
for _ in $(seq 60); do
  states="$(docker compose ps --format '{{.Health}}')"
  grep -q starting <<<"$states" || break
  sleep 5
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
if grep -qE 'starting|unhealthy' <<<"$(docker compose ps --format '{{.Health}}')"; then
  echo "Some services aren't healthy; see: docker compose logs <service>" >&2
  exit 1
fi

log "Clean up old images"
docker image prune -f
