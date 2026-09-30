#!/usr/bin/env bash
# Changes the basic-auth password in front of LabFlow and LedgerDashboard
# (user stays BASIC_AUTH_USER) and restarts Caddy. Run on the server:
#
#   ssh -t deploy@<server> /srv/portfolio/ControlPanel/deploy/vps/set-basic-auth.sh
set -euo pipefail

CP="${PORTFOLIO_ROOT:-/srv/portfolio}/ControlPanel"
ENV="$CP/.env"
[[ -f "$ENV" ]] || { echo "Missing $ENV (run make-env.sh first)." >&2; exit 1; }

read -r -s -p "New basic-auth password (12+ chars): " P1; echo
read -r -s -p "Again: " P2; echo
[[ "$P1" == "$P2" ]] || { echo "They differ." >&2; exit 1; }
[[ ${#P1} -ge 12 ]] || { echo "Too short." >&2; exit 1; }
# A password typed with a non-Latin keyboard layout by mistake looks fine
# on screen (nothing is shown) and then never matches in the browser.
[[ "$P1" == "$(printf '%s' "$P1" | LC_ALL=C tr -cd '\40-\176')" ]] \
  || { echo "Only English letters, digits and symbols, please (check the keyboard layout)." >&2; exit 1; }

HASH="$(printf '%s\n' "$P1" | docker run --rm -i caddy:2 caddy hash-password)"
unset P1 P2
[[ "$HASH" == \$2* ]] || { echo "Hashing failed." >&2; exit 1; }

# bcrypt hashes are [A-Za-z0-9./$] only, so | is a safe sed delimiter.
sed -i "s|^BASIC_AUTH_HASH=.*|BASIC_AUTH_HASH='$HASH'|" "$ENV"
cd "$CP"
docker compose up -d caddy
echo "Done. User: $(grep -E '^BASIC_AUTH_USER=' "$ENV" | cut -d= -f2-)"
