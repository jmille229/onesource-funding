#!/usr/bin/env bash
# Nightly backup of the database and uploaded files.
#
# Install on the VPS (from apps/constructpm):
#   chmod +x infra/backup.sh
#   sudo crontab -e
#   0 3 * * * /root/onesource-funding/apps/constructpm/infra/backup.sh >> /var/log/constructpm-backup.log 2>&1
#
# Backups land in ./backups and are pruned after RETENTION_DAYS. That protects
# against application-level mistakes (a bad migration, a wrong delete) but NOT
# against losing the server itself — copy ./backups off-box (S3, Backblaze,
# `rsync` to another host) for that.
set -euo pipefail

cd "$(dirname "$0")/.."

RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%F_%H%M)"
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"

echo "[backup $STAMP] dumping database"
$COMPOSE exec -T postgres pg_dump -U constructpm --clean --if-exists constructpm \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup $STAMP] archiving uploaded files"
# `mc` runs inside the minio container, so no credentials leave the host.
$COMPOSE exec -T minio sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --quiet --overwrite local/'"${S3_BUCKET_FILES:-constructpm-files}"' /tmp/backup >/dev/null && tar -cz -C /tmp/backup .' \
  > "$BACKUP_DIR/files-$STAMP.tar.gz"

echo "[backup $STAMP] pruning backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -name '*.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup $STAMP] done:"
ls -lh "$BACKUP_DIR" | tail -4
