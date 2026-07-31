#!/bin/bash
# Runs once, on first Postgres initialization (empty data dir), as the superuser
# POSTGRES_USER on POSTGRES_DB. Applies the ConstructPM migrations in order, then
# sets the RLS-scoped app role's password from the environment.
#
# Because POSTGRES_USER is a superuser, it has BYPASSRLS + CREATEROLE — exactly
# what V002 needs to create constructpm_app, FORCE RLS, and own the SECURITY
# DEFINER auth functions so the login/refresh flow can read across tenants.
set -euo pipefail

echo "[db-init] applying migrations as ${POSTGRES_USER} on ${POSTGRES_DB}"
for f in /migrations/V*.sql; do
  echo "[db-init]   -> $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

if [ -z "${CONSTRUCTPM_APP_PASSWORD:-}" ]; then
  echo "[db-init] FATAL: CONSTRUCTPM_APP_PASSWORD is not set" >&2
  exit 1
fi

echo "[db-init] setting constructpm_app password"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "ALTER ROLE constructpm_app WITH LOGIN PASSWORD '${CONSTRUCTPM_APP_PASSWORD}';"

echo "[db-init] done"
