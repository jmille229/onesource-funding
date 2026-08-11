#!/usr/bin/env bash
# Creates a OneSource operator account for the factoring console.
#
# There is no self-registration for operators, deliberately: these accounts reach
# factoring data across every client, so they are provisioned by hand on the
# server and never through a public endpoint.
#
# Run from apps/constructpm on the VPS:
#   ./infra/create-operator.sh ops@os-funding.com "Jane Doe"
#
# The password is read from the terminal, never passed as an argument — argv is
# visible to any process on the box and lands in your shell history.
set -euo pipefail

cd "$(dirname "$0")/.."

EMAIL="${1:-}"
NAME="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$NAME" ]; then
  echo "usage: $0 <email> \"<full name>\"" >&2
  exit 1
fi

FIRST="${NAME%% *}"
LAST="${NAME#* }"
[ "$LAST" = "$NAME" ] && LAST="-"

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

if ! grep -qE '^FACTORING_ADMIN_PASSWORD=.+' .env.production 2>/dev/null; then
  echo "FACTORING_ADMIN_PASSWORD is not set in .env.production." >&2
  echo "The console is disabled without it — set it and redeploy first." >&2
  exit 1
fi

read -r -s -p "Password for $EMAIL: " PW; echo
read -r -s -p "Confirm: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "Passwords do not match." >&2; exit 1; }
[ "${#PW}" -ge 12 ] || { echo "Use at least 12 characters." >&2; exit 1; }

# Hash inside the API container, which already has argon2 built for this
# platform, using the same parameters as the application.
HASH="$(printf '%s' "$PW" | $COMPOSE exec -T api node -e '
  let s = "";
  process.stdin.on("data", d => s += d).on("end", async () => {
    const argon2 = (await import("argon2")).default;
    process.stdout.write(await argon2.hash(s, {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    }));
  });
')"

[ -n "$HASH" ] || { echo "Failed to hash the password." >&2; exit 1; }

# format(%L) quotes the literal server-side; the hash never lands in shell
# interpolation inside the SQL string.
$COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U constructpm -d constructpm \
  -v email="$EMAIL" -v hash="$HASH" -v first="$FIRST" -v last="$LAST" <<'SQL'
INSERT INTO platform_users (email, password_hash, first_name, last_name)
VALUES (:'email', :'hash', :'first', :'last')
ON CONFLICT DO NOTHING;

-- ON CONFLICT covers a re-run against an existing email; report which happened.
SELECT CASE WHEN COUNT(*) = 0 THEN 'no account created — that email already exists'
            ELSE 'operator account ready' END AS result
  FROM platform_users
 WHERE LOWER(email) = LOWER(:'email') AND created_at > NOW() - INTERVAL '10 seconds';
SQL

echo
echo "Sign in at https://$(grep -E '^DOMAIN=' .env.production | cut -d= -f2)/admin"
