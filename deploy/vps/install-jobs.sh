#!/usr/bin/env bash
# Puts the server's scheduled jobs in the deploy user's crontab, replacing the lines it put there before and
# leaving any other line alone. Run as deploy after a deploy that changes the schedule:
#
#   deploy/vps/install-jobs.sh
#
# Times are the server's (UTC on the VPS): 03:30 UTC is 22:30 or 23:30 in Toronto, after the clinics close.
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
LOGS="${BACKUP_DIR:-/srv/backups}"
MARK="# portfolio job (install-jobs.sh)"

jobs="$(cat <<EOF
30 3 * * * $CP/deploy/vps/backup.sh >> $LOGS/backup.log 2>&1 $MARK
0 5 1 * * $CP/deploy/vps/restore-test.sh >> $LOGS/restore-test.log 2>&1 $MARK
*/5 * * * * $CP/deploy/vps/watchdog.sh >> $LOGS/watchdog.log 2>&1 $MARK
0 4 * * 0 find $LOGS -maxdepth 1 -name '*.log' -size +20M -exec truncate -s 0 {} + $MARK
EOF
)"

# The old backup line from the README (before this script) is replaced as well.
{ crontab -l 2>/dev/null | grep -vF "$MARK" | grep -vF "$CP/deploy/vps/backup.sh" || true; echo "$jobs"; } | crontab -
echo "Scheduled jobs:"
crontab -l | grep -F "$MARK" | sed "s| $MARK||"
