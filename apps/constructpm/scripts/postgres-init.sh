#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Application roles
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
      CREATE ROLE app_user;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
      CREATE ROLE audit_writer;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_reader') THEN
      CREATE ROLE audit_reader;
    END IF;
  END
  \$\$;

  -- Grant app role to the main user
  GRANT app_user TO constructpm;
  GRANT audit_writer TO constructpm;
  GRANT audit_reader TO constructpm;
EOSQL
