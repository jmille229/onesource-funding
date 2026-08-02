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

echo "wrote:"
echo "  $DIR/jwt_private.pem"
echo "  $DIR/jwt_public.pem"
