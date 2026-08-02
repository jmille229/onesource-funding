#!/usr/bin/env bash
# Deploy the current published images. Run on the VPS from apps/constructpm:
#   ./infra/deploy.sh
#
# Pulls the images CI built, applies any new migrations (the one-shot `migrate`
# service, which the API waits on), then restarts. Typically ~30 seconds, versus
# ~10 minutes to build on the box.
#
# Roll back by pinning a commit SHA and re-running:
#   IMAGE_TAG=<sha> ./infra/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

echo "▶ pulling images"
$COMPOSE pull --quiet postgres redis minio api web migrate caddy

echo "▶ applying migrations"
# Runs to completion before anything else starts; a failure aborts the deploy
# with the old containers still serving traffic.
$COMPOSE up --exit-code-from migrate migrate

echo "▶ starting services"
$COMPOSE up -d --remove-orphans

echo "▶ waiting for the API to report healthy"
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "require('http').get('http://localhost:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "✅ deployed — $($COMPOSE ps --format '{{.Service}}' | tr '\n' ' ')"
    exit 0
  fi
  sleep 2
done

echo "❌ API did not become healthy; recent logs:" >&2
$COMPOSE logs --tail 50 api >&2
exit 1
