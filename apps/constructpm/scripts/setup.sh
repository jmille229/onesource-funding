#!/bin/bash
set -e

BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${BLUE}🏗️  ConstructPM — Local Setup${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Check prerequisites ──────────────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗ $1 not found. Please install it first.${RESET}"
    exit 1
  else
    echo -e "${GREEN}✓ $1 $(${2:-$1 --version 2>&1 | head -1})${RESET}"
  fi
}

echo ""
echo -e "${BOLD}Checking prerequisites...${RESET}"
check_cmd node
check_cmd npm
check_cmd docker

NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 20 ? 1 : 0)" 2>/dev/null && echo "OK" || echo "FAIL")
if [ "$NODE_VER" = "FAIL" ]; then
  echo -e "${RED}✗ Node.js 20+ required. Current: $(node --version)${RESET}"
  exit 1
fi

# ─── Copy env file ────────────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  echo ""
  echo -e "${BOLD}Creating .env.local from template...${RESET}"
  cp .env.example .env.local
  echo -e "${GREEN}✓ .env.local created${RESET}"
else
  echo -e "${YELLOW}ℹ .env.local already exists — skipping${RESET}"
fi

# ─── Install dependencies ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Installing dependencies...${RESET}"
npm install
echo -e "${GREEN}✓ Dependencies installed${RESET}"

# ─── Start Docker services ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Starting Docker services...${RESET}"
docker compose up -d
echo -e "${GREEN}✓ Docker services started${RESET}"

# ─── Wait for Postgres ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Waiting for PostgreSQL to be ready...${RESET}"
for i in {1..30}; do
  if docker exec cpm-postgres pg_isready -U constructpm -d constructpm_dev &>/dev/null; then
    echo -e "${GREEN}✓ PostgreSQL ready${RESET}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}✗ PostgreSQL did not start in time${RESET}"
    exit 1
  fi
  printf "  Waiting... (%d/30)\r" $i
  sleep 2
done

# ─── Run migrations ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Running database migrations...${RESET}"
npm run migrate
echo -e "${GREEN}✓ Migrations complete${RESET}"

# ─── Seed demo data ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Seeding demo data...${RESET}"
npm run seed
echo -e "${GREEN}✓ Demo data seeded${RESET}"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}${GREEN}✅  Setup complete!${RESET}"
echo ""
echo -e "  Start dev servers:  ${BOLD}npm run dev${RESET}"
echo ""
echo -e "  ${BOLD}URLs once running:${RESET}"
echo -e "  Frontend  →  http://localhost:5173"
echo -e "  API       →  http://localhost:3001"
echo -e "  MailHog   →  http://localhost:8025"
echo -e "  MinIO     →  http://localhost:9001"
echo ""
echo -e "  ${BOLD}Demo credentials:${RESET}"
echo -e "  Email     →  admin@hartwell.com"
echo -e "  Password  →  demo1234"
echo ""
