#!/usr/bin/env bash
# A client user lost their phone and their recovery codes: switch off their
# two-step sign-in so they can sign in with their password again (and set it up
# again — at once if their company requires it). Run on the server from
# apps/constructpm:
#   ./infra/reset-user-2fa.sh person@client.com
#
# This is exactly what someone taking over an account would ask support for.
# Confirm it's really them first: call them back on a number you already have
# on file, not one given in the request.
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?usage: $0 <user email>}"
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
OUT=$($COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -qtA -U constructpm -d constructpm -v email="$EMAIL" <<'SQL'
SELECT count(*) FROM (SELECT auth_mfa_disable(id) FROM users WHERE lower(email) = lower(:'email') AND deleted_at IS NULL) s;
SQL
)
if [ "$(echo "$OUT" | tr -d '[:space:]')" = "0" ]; then
  echo "No user with the email $EMAIL." >&2; exit 1
fi
echo "✓ Two-step sign-in switched off for $EMAIL."
