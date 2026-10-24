# shellcheck shell=bash
# Sourced by backup.sh, backup-offsite.sh, restore-test.sh and watchdog.sh: tells healthchecks.io how a job went.
# healthchecks.io watches from outside, so it also notices the job that never ran (server down, cron broken) and
# alerts by e-mail (or SMS, Signal, ... set up there).
#
# /srv/secrets/monitoring.env (mode 600, written by hand, see README.md "Monitoring"):
#   HC_PING_KEY=<the project's ping key from healthchecks.io, Settings>
# Each job pings https://hc-ping.com/<key>/<job>; the first ping creates the check. Without the file: no pings.
#
#   ping_check <job> start|ok|fail [message]

MONITORING_ENV="${MONITORING_ENV:-/srv/secrets/monitoring.env}"
HC_PING_KEY=""
# shellcheck disable=SC1090
[[ -r "$MONITORING_ENV" ]] && source "$MONITORING_ENV"

ping_check() {
  local job="$1" state="$2" message="${3:-}" suffix=""
  [[ -n "$HC_PING_KEY" ]] || return 0
  case "$state" in
    start) suffix="/start" ;;
    fail) suffix="/fail" ;;
    ok) suffix="" ;;
    *) echo "ping_check: unknown state $state" >&2; return 0 ;;
  esac
  # The message shows in healthchecks.io's event log and its alert e-mail; never fail the job over a ping.
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$message" \
    "https://hc-ping.com/$HC_PING_KEY/$job$suffix?create=1" || echo "healthchecks.io could not be told ($job $state)" >&2
}
