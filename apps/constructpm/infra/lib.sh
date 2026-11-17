#!/usr/bin/env bash
# Shared helpers for the infra scripts (deploy, backup, restore, migrate-files).
# Sourced, not run. Expects the working directory to be apps/constructpm.

# ─── .env.production, read without executing it ──────────────────────────────
# `source .env.production` would run any $(…) in a value. This reads KEY=VALUE
# lines only, strips one layer of surrounding quotes, and exports them.
load_env() {
  local file="${1:-.env.production}"
  [ -f "$file" ] || { echo "✗ $file not found (run from apps/constructpm)" >&2; exit 1; }
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    val="${val%$'\r'}"
    if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    # The shell environment wins (e.g. IMAGE_TAG=abc ./infra/deploy.sh).
    if [ -z "${!key+x}" ]; then export "$key=$val"; fi
  done < "$file"
}

# ─── Optional services ───────────────────────────────────────────────────────
# minio:  while uploads still live in the in-stack MinIO (S3_ENDPOINT unset or
#         pointing at it). Turning it off would orphan the files.
# clamav: when malware scanning is configured.
set_profiles() {
  local profiles=()
  if [ -z "${S3_ENDPOINT:-}" ] || [[ "${S3_ENDPOINT}" == *"minio:9000"* ]]; then profiles+=(minio); fi
  if [ -n "${CLAMAV_HOST:-}" ]; then profiles+=(clamav); fi
  COMPOSE_PROFILES="$(IFS=,; echo "${profiles[*]:-}")"
  export COMPOSE_PROFILES
}

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
NETWORK="constructpm_constructpm"
RCLONE_IMAGE="rclone/rclone:1.68.2"

# ─── Encryption for backups ──────────────────────────────────────────────────
# AES-256 with a key derived from BACKUP_PASSPHRASE (PBKDF2, 200k rounds).
# Keep the passphrase in a password manager: without it no backup can be read.
require_passphrase() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "✗ BACKUP_PASSPHRASE is not set in .env.production — backups must be encrypted." >&2
    echo "  Generate one with: openssl rand -base64 32  (and save it in your password manager)" >&2
    exit 1
  fi
}
encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE; }

# ─── Off-site storage, through rclone in a container ─────────────────────────
# Remotes, all configured from the environment (nothing written to disk):
#   offsite:  the backup bucket (BACKUP_S3_*)
#   vault:    offsite:<bucket>/files, encrypted file-by-file with the passphrase
#   store:    where the app keeps uploads (S3_* — MinIO or managed storage)
offsite_configured() { [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; }

rclone() {
  local obscured=""
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    obscured="$(docker run --rm "$RCLONE_IMAGE" obscure "$BACKUP_PASSPHRASE")"
  fi
  docker run --rm --network "$NETWORK" \
    -v "$PWD/${BACKUP_DIR:-./backups}:/backups" \
    -e RCLONE_CONFIG_OFFSITE_TYPE=s3 \
    -e RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}" \
    -e RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" \
    -e RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-auto}" \
    -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}" \
    -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}" \
    -e RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true \
    -e RCLONE_CONFIG_VAULT_TYPE=crypt \
    -e RCLONE_CONFIG_VAULT_REMOTE="offsite:${BACKUP_S3_BUCKET:-none}/files" \
    -e RCLONE_CONFIG_VAULT_PASSWORD="$obscured" \
    -e RCLONE_CONFIG_STORE_TYPE=s3 \
    -e RCLONE_CONFIG_STORE_PROVIDER=Other \
    -e RCLONE_CONFIG_STORE_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}" \
    -e RCLONE_CONFIG_STORE_REGION="${S3_REGION:-us-east-1}" \
    -e RCLONE_CONFIG_STORE_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}" \
    -e RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}" \
    -e RCLONE_CONFIG_STORE_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}" \
    -e RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true \
    "$RCLONE_IMAGE" "$@"
}

# ─── Monitoring pings (healthchecks.io or any URL that takes /start and /fail) ─
ping_check() {
  local suffix="${1:-}"
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}${suffix}" || true
}
