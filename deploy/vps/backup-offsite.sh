#!/usr/bin/env bash
# Sends one night's backup folder and the clinic secrets off the server, encrypted, with restic (in its container,
# nothing to install). Called by backup.sh with the folder it just wrote; by hand:
#
#   deploy/vps/backup-offsite.sh /srv/backups/daily/<stamp>
#
# /srv/secrets/backup/restic.env (mode 600, written by hand, see README.md "Off-server backups"):
#   RESTIC_REPOSITORY=s3:https://s3.bhs.io.cloud.ovh.net/<container>      # OVH Object Storage, Beauharnois (Canada)
#   RESTIC_PASSWORD=<long random; kept in the password manager too: without it the copies can't be read>
#   AWS_ACCESS_KEY_ID=<the S3 user's access key>
#   AWS_SECRET_ACCESS_KEY=<its secret key>
#   AWS_DEFAULT_REGION=bhs
# Any restic repository works (another S3 provider, sftp:...): only RESTIC_REPOSITORY changes.
#
# Encrypted before it leaves (AES-256, the key from RESTIC_PASSWORD), deduplicated, and thinned to 14 daily,
# 8 weekly and 12 monthly snapshots. restore-test.sh checks once a month that a copy really restores.
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
# shellcheck source=deploy/vps/notify.sh
source "$CP/deploy/vps/notify.sh"
RESTIC_ENV="${RESTIC_ENV:-/srv/secrets/backup/restic.env}"
SECRETS="${SECRETS_DIR:-/srv/secrets}"
RESTIC_IMAGE="restic/restic:0.17.3"

[[ $# -eq 1 && -d "$1" ]] || { echo "Usage: $0 <backup folder>" >&2; exit 1; }
FOLDER="$(cd "$1" && pwd)"

if [[ ! -r "$RESTIC_ENV" ]]; then
  echo "  off-server copy: not configured ($RESTIC_ENV missing); the backup stays on this server only"
  ping_check backup-offsite fail "Not configured: $RESTIC_ENV is missing"
  exit 0
fi

ping_check backup-offsite start
trap 'ping_check backup-offsite fail "backup-offsite.sh failed at line $LINENO"' ERR

# The folder is mounted at a fixed path, so every night's snapshot has the same paths and restic deduplicates them.
restic() {
  docker run --rm -i --env-file "$RESTIC_ENV" --hostname "$(hostname)" \
    -v restic-cache:/root/.cache/restic \
    -v "$FOLDER:/backup/daily:ro" -v "$SECRETS:/backup/secrets:ro" \
    "$RESTIC_IMAGE" "$@"
}

# The first run makes the repository (an existing one answers `cat config`).
restic cat config >/dev/null 2>&1 || restic init
# Not the repository's own key and credentials (they are in the password manager; a copy behind them helps nobody).
restic backup --quiet --tag nightly --exclude /backup/secrets/backup /backup/daily /backup/secrets
restic forget --quiet --tag nightly --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
summary="$(restic snapshots --tag nightly --latest 1 --compact | tail -n +3 | head -1 | tr -s ' ')"
echo "  off-server copy ok: $summary"

trap - ERR
ping_check backup-offsite ok "$summary"
