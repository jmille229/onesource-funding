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
    psql_admin() { $COMPOSE exec -T postgres psql -U constructpm -d postgres -q -c "SET client_min_messages = warning" -c "$1" >/dev/null; }
    # The scratch copy goes, however this ends.
    trap 'psql_admin "DROP DATABASE IF EXISTS restore_check" 2>/dev/null || true' EXIT
    rm -f "$BACKUP_DIR/restore_check.ok"
    echo "▶ test-restoring $file into a scratch database"
    psql_admin "DROP DATABASE IF EXISTS restore_check"
    psql_admin "CREATE DATABASE restore_check"
    # psql keeps going past SQL errors (they're counted below); a failure of the
    # pipeline itself means the file couldn't be decrypted or unpacked.
    if ! decrypt < "$file" | gunzip | $COMPOSE exec -T postgres psql -U constructpm -d restore_check -q -v ON_ERROR_STOP=0 >/dev/null 2>"$BACKUP_DIR/restore_check.log"; then
      echo "✗ couldn't read $file — is BACKUP_PASSPHRASE the one it was made with?" >&2; exit 1
    fi
    q="SELECT 'companies', count(*)::text FROM companies
       UNION ALL SELECT 'logins', count(*)::text FROM users
       UNION ALL SELECT 'invoices', count(*)::text FROM invoices
       UNION ALL SELECT 'advances', count(*)::text FROM factored_invoices
       UNION ALL SELECT 'ledger entries', count(*)::text FROM factoring_events
       UNION ALL SELECT 'newest migration', max(version) FROM schema_migrations"
    restored="$($COMPOSE exec -T postgres psql -U constructpm -d restore_check -v ON_ERROR_STOP=1 -tA -F'|' -c "$q")" \
      || { echo "✗ the restored copy is missing tables — see $BACKUP_DIR/restore_check.log" >&2; exit 1; }
    live="$($COMPOSE exec -T postgres psql -U constructpm -d constructpm -tA -F'|' -c "$q" 2>/dev/null || true)"
    echo "▶ what came back (the live database may have more if it changed since the backup):"
    paste -d'|' <(printf '%s\n' "$restored") <(printf '%s\n' "$live" | cut -d'|' -f2) \
      | awk -F'|' 'BEGIN { printf "    %-18s %-30s %s\n", "", "in the backup", "live now" }
                   { printf "    %-18s %-30s %s\n", $1, $2, $3 }'
    errors="$(grep -c 'ERROR' "$BACKUP_DIR/restore_check.log" || true)"
    if [ "$errors" != "0" ]; then
      echo "✗ $errors errors while loading it; the first few:" >&2
      grep 'ERROR' "$BACKUP_DIR/restore_check.log" | head -5 >&2
      exit 1
    fi
    date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/restore_check.ok"
    echo "✓ restore test passed: the backup decrypts and loads cleanly. Scratch database dropped."
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
