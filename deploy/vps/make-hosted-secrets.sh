#!/usr/bin/env bash
# The hosted ClinicReport's secrets on the server, one file each, the way compose.hosted.yml hands them to the container
# (/run/secrets/<setting>). Nothing is in .env or in git:
#
#   deploy/vps/make-hosted-secrets.sh
#
#   /srv/secrets/hosted/   (HOSTED_SECRETS_DIR) mode 700, owned by deploy; each file mode 444 for the container's user
#
# Creates only what is missing. The health token is generated. The three Stripe files start empty, and the service then
# runs with billing "not set up"; to turn billing on, put each value in its file (sk_test_ only, the app refuses
# anything else) and `docker compose up -d clinicreport-hosted`. backup-offsite.sh takes this folder with /srv/secrets.
set -euo pipefail

DIR="${HOSTED_SECRETS_DIR:-/srv/secrets/hosted}"
umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

if [[ ! -e "$DIR/health-token" ]]; then
  printf '%s' "$(openssl rand -hex 24)" > "$DIR/health-token.tmp"
  mv "$DIR/health-token.tmp" "$DIR/health-token"
  echo "made health-token"
fi
for f in stripe-secret-key stripe-price stripe-webhook; do
  [[ -e "$DIR/$f" ]] && continue
  : > "$DIR/$f"
  echo "made empty $f"
done
chmod 444 "$DIR"/*
echo "secrets in $DIR"
