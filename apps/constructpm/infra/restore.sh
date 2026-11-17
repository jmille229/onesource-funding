#!/usr/bin/env bash
# Restore from the encrypted backups made by infra/backup.sh.
#
#   ./infra/restore.sh list                 what's here and off-site
#   ./infra/restore.sh verify [file]        TEST a restore: load the newest (or given) database
#                                           backup into a scratch database, count what's in it,
#                                           drop it. Touches nothing live. Do this monthly.
#   ./infra/restore.sh fetch <name>         download one backup from off-site into ./backups
#   ./infra/restore.sh db <file>            REPLACE the live database with a backup
#   ./infra/restore.sh files                REPLACE uploaded files with the off-site copy
#   ./infra/restore.sh secrets <file>       decrypt a secrets backup into ./restored-secrets
#
# On a brand-new server: copy the repo, put BACKUP_PASSPHRASE and the BACKUP_S3_*
# settings in a minimal .env.production, `fetch` the newest secrets backup and
# `secrets` it to recover the full .env.production and secrets/, then deploy,
# then `db` and `files`. DEPLOY.md walks through it.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib.sh

load_env
set_profiles
require_passphrase
BACKUP_DIR="${BACKUP_DIR:-./backups}"
export BACKUP_DIR
mkdir -p "$BACKUP_DIR"

latest_local_db() { ls -1t "$BACKUP_DIR"/db-*.sql.gz.enc 2>/dev/null | head -1 || true; }

confirm() {
  echo "$1"
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
}

case "${1:-}" in
  list)
    echo "── On this server ($BACKUP_DIR)"
    ls -lht "$BACKUP_DIR" | head -20
    if offsite_configured; then
      echo "── Off-site (${BACKUP_S3_BUCKET})"
      rclone lsl "offsite:${BACKUP_S3_BUCKET}/db" | sort -k2,3 | tail -10
      rclone lsl "offsite:${BACKUP_S3_BUCKET}/secrets" | sort -k2,3 | tail -3
    fi
    ;;

  fetch)
    name="${2:?which backup? e.g. db-20261117-031500.sql.gz.enc}"
    folder=db; [[ "$name" == secrets-* ]] && folder=secrets
    rclone copy "offsite:${BACKUP_S3_BUCKET}/$folder/$name" /backups/
    echo "✓ $BACKUP_DIR/$name"
    ;;

  verify)
    file="${2:-$(latest_local_db)}"
    [ -n "$file" ] && [ -f "$file" ] || { echo "✗ no database backup found in $BACKUP_DIR" >&2; exit 1; }
    echo "▶ test-restoring $file into a scratch database"
    $COMPOSE exec -T postgres psql -U constructpm -d postgres -qc "DROP DATABASE IF EXISTS restore_check" >/dev/null
    $COMPOSE exec -T postgres psql -U constructpm -d postgres -qc "CREATE DATABASE restore_check" >/dev/null
    decrypt < "$file" | gunzip | $COMPOSE exec -T postgres psql -U constructpm -d restore_check -q -v ON_ERROR_STOP=0 >/dev/null 2>"$BACKUP_DIR/restore_check.log" || true
    echo "▶ what came back:"
    $COMPOSE exec -T postgres psql -U constructpm -d restore_check -c "
      SELECT 'companies' AS what, count(*) FROM companies
      UNION ALL SELECT 'users', count(*) FROM users
      UNION ALL SELECT 'invoices', count(*) FROM invoices
      UNION ALL SELECT 'advances', count(*) FROM factored_invoices
      UNION ALL SELECT 'ledger events', count(*) FROM factoring_events
      UNION ALL SELECT 'newest migration', max(version)::bigint FROM schema_migrations"
    $COMPOSE exec -T postgres psql -U constructpm -d postgres -qc "DROP DATABASE restore_check" >/dev/null
    errors="$(grep -c 'ERROR' "$BACKUP_DIR/restore_check.log" || true)"
    echo "✓ restore test finished (${errors} errors; details in $BACKUP_DIR/restore_check.log). Scratch database dropped."
    ;;

  db)
    file="${2:?which backup file?}"
    [ -f "$file" ] || { echo "✗ $file not found" >&2; exit 1; }
    confirm "This REPLACES the live database with $file. Everything since that backup is lost."
    echo "▶ taking a backup of the current state first"
    ./infra/backup.sh --db-only
    echo "▶ stopping the API"
    $COMPOSE stop api
    decrypt < "$file" | gunzip | $COMPOSE exec -T postgres psql -U constructpm -d constructpm -q -v ON_ERROR_STOP=1
    echo "▶ starting again (migrations re-apply anything newer than the backup)"
    ./infra/deploy.sh
    ;;

  files)
    offsite_configured || { echo "✗ no off-site settings (BACKUP_S3_*)" >&2; exit 1; }
    confirm "This makes the uploaded files match the off-site copy (files added since are removed)."
    rclone sync vault:current "store:${S3_BUCKET_FILES:-constructpm-files}"
    echo "✓ files restored"
    ;;

  secrets)
    file="${2:?which secrets backup?}"
    mkdir -p restored-secrets && chmod 700 restored-secrets
    decrypt < "$file" | tar -xz -C restored-secrets
    echo "✓ decrypted into ./restored-secrets — copy what you need into place, then delete that folder."
    ;;

  *)
    sed -n '2,16p' "$0"; exit 1 ;;
esac
