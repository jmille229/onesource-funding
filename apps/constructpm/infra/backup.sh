#!/usr/bin/env bash
# Nightly backup: the database, uploaded files, and this server's secrets —
# encrypted, kept here for RETENTION_DAYS and copied off the server.
#
#   ./infra/backup.sh            everything (run nightly from cron)
#   ./infra/backup.sh --db-only  just the database (deploy.sh runs this first)
#
# Install the nightly run (from apps/constructpm):
#   sudo crontab -e
#   15 3 * * * cd /root/onesource-funding/apps/constructpm && ./infra/backup.sh >> /var/log/constructpm-backup.log 2>&1
#
# Settings in .env.production (see .env.production.example):
#   BACKUP_PASSPHRASE        required — encrypts everything; keep it in a password manager
#   BACKUP_S3_*              the off-site bucket (another provider or account than the app's files)
#   BACKUP_HEALTHCHECK_URL   optional — pinged on start/success/failure (e.g. healthchecks.io),
#                            so a backup that stops running or fails emails you
#
# What lands where:
#   ./backups/db-<stamp>.sql.gz.enc          → offsite:<bucket>/db/
#   ./backups/secrets-<stamp>.tar.gz.enc     → offsite:<bucket>/secrets/  (.env.production + secrets/)
#   uploaded files, encrypted per file        → offsite:<bucket>/files/current (deleted ones kept 35 days)
#
# Restore and test-restore: infra/restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib.sh

DB_ONLY=false
[ "${1:-}" = "--db-only" ] && DB_ONLY=true

load_env
set_profiles
require_passphrase

RETENTION_DAYS="${RETENTION_DAYS:-14}"
OFFSITE_RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-35}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
export BACKUP_DIR
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

$DB_ONLY || ping_check /start
trap 'echo "[backup $STAMP] FAILED" >&2; $DB_ONLY || ping_check /fail' ERR

echo "[backup $STAMP] database"
$COMPOSE exec -T postgres pg_dump -U constructpm --clean --if-exists constructpm \
  | gzip | encrypt > "$BACKUP_DIR/db-$STAMP.sql.gz.enc"
# A dump that small means something went wrong upstream of the pipe.
[ "$(stat -c %s "$BACKUP_DIR/db-$STAMP.sql.gz.enc")" -gt 1000 ] || { echo "database dump is empty" >&2; false; }

if ! $DB_ONLY; then
  echo "[backup $STAMP] secrets (.env.production, secrets/)"
  tar -cz .env.production secrets 2>/dev/null | encrypt > "$BACKUP_DIR/secrets-$STAMP.tar.gz.enc"
fi

if offsite_configured; then
  # The plain local copy made while there was no off-site storage isn't needed
  # any more (the files are off-site, encrypted), and shouldn't sit on disk.
  rm -rf "$BACKUP_DIR/files-mirror"
  echo "[backup $STAMP] copying off the server"
  rclone copy "/backups/db-$STAMP.sql.gz.enc" "offsite:${BACKUP_S3_BUCKET}/db/"
  if ! $DB_ONLY; then
    rclone copy "/backups/secrets-$STAMP.tar.gz.enc" "offsite:${BACKUP_S3_BUCKET}/secrets/"
    echo "[backup $STAMP] uploaded files → off-site (encrypted, incremental)"
    rclone sync "store:${S3_BUCKET_FILES:-constructpm-files}" vault:current --backup-dir "vault:deleted/$STAMP"
    echo "[backup $STAMP] pruning off-site copies older than ${OFFSITE_RETENTION_DAYS}d"
    rclone delete "offsite:${BACKUP_S3_BUCKET}/db" --min-age "${OFFSITE_RETENTION_DAYS}d"
    rclone delete "offsite:${BACKUP_S3_BUCKET}/secrets" --min-age "${OFFSITE_RETENTION_DAYS}d"
    rclone delete vault:deleted --min-age "${OFFSITE_RETENTION_DAYS}d" --rmdirs
  fi
else
  echo "[backup $STAMP] ⚠ NO OFF-SITE COPY: set BACKUP_S3_* in .env.production." >&2
  echo "  Until then, losing this server loses the data." >&2
  if ! $DB_ONLY; then
    # Files stay on this server only; archive them so a local restore is possible.
    echo "[backup $STAMP] uploaded files (local archive)"
    mkdir -p "$BACKUP_DIR/files-mirror"
    rclone sync "store:${S3_BUCKET_FILES:-constructpm-files}" /backups/files-mirror
    tar -cz -C "$BACKUP_DIR/files-mirror" . | encrypt > "$BACKUP_DIR/files-$STAMP.tar.gz.enc"
  fi
fi

echo "[backup $STAMP] pruning local backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -maxdepth 1 -name '*.enc' -mtime "+$RETENTION_DAYS" -delete
# Unencrypted backups from before this script encrypted them.
find "$BACKUP_DIR" -maxdepth 1 -name '*.gz' -mtime "+$RETENTION_DAYS" -delete

# A server that fills its disk stops taking uploads and then stops entirely.
USED="$(df -P . | awk 'NR==2 {gsub("%",""); print $5}')"
if [ "$USED" -ge 85 ]; then
  echo "[backup $STAMP] ⚠ disk is ${USED}% full" >&2
  $DB_ONLY || ping_check /fail
  exit 0
fi

$DB_ONLY || ping_check
echo "[backup $STAMP] done"
ls -lh "$BACKUP_DIR" | tail -4
