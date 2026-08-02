#!/usr/bin/env bash
# Generates the RS256 JWT key pair the API signs access tokens with, writing the
# PEM files into ./secrets where docker-compose.prod.yml mounts them.
# Run once from the apps/constructpm directory:  ./infra/gen-jwt-keys.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/secrets"
mkdir -p "$DIR"

if [ -f "$DIR/jwt_private.pem" ]; then
  echo "refusing to overwrite existing $DIR/jwt_private.pem" >&2
  exit 1
fi

# 2048-bit RSA private key in PKCS#8 PEM, plus the matching public key.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$DIR/jwt_private.pem"
openssl rsa -in "$DIR/jwt_private.pem" -pubout -out "$DIR/jwt_public.pem"
chmod 600 "$DIR/jwt_private.pem"
chmod 644 "$DIR/jwt_public.pem"

# The API container runs as uid 1001 (packages/api/Dockerfile), and a bind mount
# keeps the host's ownership and mode. A root-owned 0600 key is therefore
# unreadable inside the container, and the API crash-loops on boot with
# EACCES opening /run/secrets/jwt_private.pem.
#
# Hand the keys to that uid rather than widening the mode — 0600 owned by the
# app user is stricter than 0644 owned by root.
if [ "$(id -u)" = "0" ]; then
  chown 1001:1001 "$DIR/jwt_private.pem" "$DIR/jwt_public.pem"
fi

echo "wrote:"
echo "  $DIR/jwt_private.pem"
echo "  $DIR/jwt_public.pem"
