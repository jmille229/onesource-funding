#!/usr/bin/env bash
# Move uploaded files from the in-stack MinIO to managed storage (S3, Cloudflare
# R2, Backblaze B2, DigitalOcean Spaces). Run on the server from apps/constructpm.
#
# 1. Create a private bucket at the provider (versioning on, if offered) and an
#    access key limited to that bucket.
# 2. Put the NEW settings in .env.production under NEW_S3_* (keep the old S3_*):
#      NEW_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
#      NEW_S3_REGION=auto
#      NEW_S3_BUCKET_FILES=onesource-files
#      NEW_S3_ACCESS_KEY=...
#      NEW_S3_SECRET_KEY=...
# 3. ./infra/migrate-files.sh            copies everything (safe to re-run; only new files copy)
#    ./infra/migrate-files.sh --check    compares the two (counts and sizes)
# 4. Switch: replace S3_* with the NEW_S3_* values (S3_FORCE_PATH_STYLE=false for
#    AWS; S3_SERVER_SIDE_ENCRYPTION=none for R2 and Spaces), run migrate-files.sh
#    once more to catch stragglers, then ./infra/deploy.sh. MinIO stops running
#    on its own once S3_ENDPOINT no longer points at it; its volume stays until
#    you remove it (docker volume rm constructpm_minio_data) after a few weeks.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/lib.sh
load_env
set_profiles
: "${NEW_S3_ENDPOINT:?set NEW_S3_ENDPOINT (and the other NEW_S3_* values) in .env.production}"
: "${NEW_S3_BUCKET_FILES:?set NEW_S3_BUCKET_FILES}"

newstore() {
  docker run --rm --network "$NETWORK" \
    -e RCLONE_CONFIG_STORE_TYPE=s3 -e RCLONE_CONFIG_STORE_PROVIDER=Other \
    -e RCLONE_CONFIG_STORE_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}" -e RCLONE_CONFIG_STORE_REGION="${S3_REGION:-us-east-1}" \
    -e RCLONE_CONFIG_STORE_ACCESS_KEY_ID="${S3_ACCESS_KEY}" -e RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    -e RCLONE_CONFIG_STORE_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}" \
    -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other \
    -e RCLONE_CONFIG_NEW_ENDPOINT="${NEW_S3_ENDPOINT}" -e RCLONE_CONFIG_NEW_REGION="${NEW_S3_REGION:-auto}" \
    -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID="${NEW_S3_ACCESS_KEY}" -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY="${NEW_S3_SECRET_KEY}" \
    -e RCLONE_CONFIG_NEW_NO_CHECK_BUCKET=true \
    "$RCLONE_IMAGE" "$@"
}

SRC="store:${S3_BUCKET_FILES:-constructpm-files}"
DST="new:${NEW_S3_BUCKET_FILES}"
if [ "${1:-}" = "--check" ]; then
  echo "── current ($SRC)"; newstore size "$SRC"
  echo "── new ($DST)";     newstore size "$DST"
  newstore check "$SRC" "$DST" --one-way && echo "✓ every file is in the new bucket"
else
  echo "▶ copying $SRC → $DST (existing files are skipped)"
  newstore copy "$SRC" "$DST" --progress
  echo "✓ copied. Check with: ./infra/migrate-files.sh --check"
fi
