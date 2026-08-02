#!/bin/bash
# Generates an RSA-2048 key pair for production JWT signing (RS256)
# Run once and store the output in your secret manager — never commit the keys.

set -e
BOLD="\033[1m"; GREEN="\033[32m"; RESET="\033[0m"

echo -e "\n${BOLD}Generating RSA-2048 key pair for RS256 JWT signing...${RESET}"

openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem

echo -e "${GREEN}✓ Keys written to jwt_private.pem and jwt_public.pem${RESET}"
echo -e "\n${BOLD}Set these in your secret manager:${RESET}"
echo ""
echo "JWT_PRIVATE_KEY (keep secret — used to SIGN tokens):"
cat jwt_private.pem
echo ""
echo "JWT_PUBLIC_KEY (can be shared — used to VERIFY tokens):"
cat jwt_public.pem
echo ""
echo -e "${BOLD}⚠️  Delete these .pem files after storing in your secret manager!${RESET}"
echo "   rm jwt_private.pem jwt_public.pem"
