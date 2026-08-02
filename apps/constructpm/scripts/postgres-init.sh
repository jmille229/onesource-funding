#!/bin/bash
# Dev Postgres first-boot hook.
#
# Deliberately minimal: the schema, the constructpm_app role and all RLS policies
# come from the migrations (npm run migrate), so dev and production get their
# database from exactly the same source. Anything created here that migrations
# don't also create would be drift that only exists on developer machines.
set -e

echo "[postgres-init] dev database ready — run 'npm run migrate' to apply the schema"
