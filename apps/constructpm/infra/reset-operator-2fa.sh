#!/usr/bin/env bash
# An operator lost their phone and their recovery codes: switch off their
# two-step sign-in so the next sign-in sets it up again. Run on the server
# from apps/constructpm (shell access is the proof of authority here):
#   ./infra/reset-operator-2fa.sh ops@os-funding.com
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?usage: $0 <operator email>}"
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
$COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U constructpm -d constructpm -v email="$EMAIL" <<'SQL'
UPDATE platform_users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_last_step = 0 WHERE lower(email) = lower(:'email');
DELETE FROM platform_mfa_recovery_codes WHERE platform_user_id IN (SELECT id FROM platform_users WHERE lower(email) = lower(:'email'));
SQL
echo "✓ Two-step sign-in reset for $EMAIL — they'll set it up again at their next sign-in."
