.DEFAULT_GOAL := help
SHELL := /bin/bash

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

.PHONY: help setup install services services-down migrate seed dev dev-api dev-web reset clean logs

help: ## Show this help
	@echo ""
	@echo "$(CYAN)ConstructPM — Local Development$(RESET)"
	@echo ""
	@echo "$(YELLOW)First time setup:$(RESET)"
	@echo "  make setup        Full first-time setup (install + services + migrate + seed)"
	@echo ""
	@echo "$(YELLOW)Daily development:$(RESET)"
	@echo "  make dev          Start API + Web (requires services running)"
	@echo "  make dev-api      Start API server only"
	@echo "  make dev-web      Start Web app only"
	@echo ""
	@echo "$(YELLOW)Infrastructure:$(RESET)"
	@echo "  make services     Start Docker services (Postgres, Redis, MinIO, MailHog)"
	@echo "  make services-down Stop Docker services"
	@echo "  make migrate      Run database migrations"
	@echo "  make seed         Seed demo data"
	@echo ""
	@echo "$(YELLOW)Maintenance:$(RESET)"
	@echo "  make reset        Reset database (drop + migrate + seed)"
	@echo "  make clean        Remove node_modules and build artifacts"
	@echo "  make logs         Tail Docker service logs"
	@echo ""

# ─── First-time setup ─────────────────────────────────────────────────────────
setup: ## Full first-time setup
	@echo "$(CYAN)▶ ConstructPM Setup$(RESET)"
	@echo ""
	@echo "$(YELLOW)1/5 Checking prerequisites...$(RESET)"
	@command -v node >/dev/null 2>&1 || (echo "❌ Node.js not found. Install from https://nodejs.org (v20+)" && exit 1)
	@command -v docker >/dev/null 2>&1 || (echo "❌ Docker not found. Install from https://docker.com" && exit 1)
	@node --version | grep -E "v(2[0-9]|[3-9][0-9])" >/dev/null || (echo "❌ Node.js v20+ required" && exit 1)
	@echo "  ✓ Node $(shell node --version)"
	@echo "  ✓ npm $(shell npm --version)"
	@echo "  ✓ Docker $(shell docker --version | cut -d' ' -f3)"
	@echo ""
	@echo "$(YELLOW)2/5 Installing dependencies...$(RESET)"
	@npm install
	@echo "  ✓ Dependencies installed"
	@echo ""
	@echo "$(YELLOW)3/5 Starting Docker services...$(RESET)"
	@docker compose up -d
	@echo "  Waiting for services to be healthy..."
	@sleep 5
	@docker compose ps
	@echo ""
	@echo "$(YELLOW)4/5 Running migrations...$(RESET)"
	@$(MAKE) migrate
	@echo ""
	@echo "$(YELLOW)5/5 Seeding demo data...$(RESET)"
	@$(MAKE) seed
	@echo ""
	@echo "$(GREEN)✅ Setup complete!$(RESET)"
	@echo ""
	@echo "$(CYAN)URLs:$(RESET)"
	@echo "  App     → http://localhost:5173"
	@echo "  API     → http://localhost:3001"
	@echo "  MailHog → http://localhost:8025"
	@echo "  MinIO   → http://localhost:9001  (user: constructpm, pass: constructpm_minio_dev)"
	@echo ""
	@echo "$(CYAN)Demo login:$(RESET)"
	@echo "  Email    → admin@hartwell.com"
	@echo "  Password → demo1234"
	@echo ""
	@echo "Run $(YELLOW)make dev$(RESET) to start the application."
	@echo ""

# ─── Install ──────────────────────────────────────────────────────────────────
install: ## Install npm dependencies
	npm install

# ─── Docker services ──────────────────────────────────────────────────────────
services: ## Start Docker services
	docker compose up -d
	@echo "$(GREEN)✓ Services running$(RESET)"
	@echo "  Postgres  → localhost:5432"
	@echo "  Redis     → localhost:6379"
	@echo "  MinIO     → localhost:9000 (console: localhost:9001)"
	@echo "  MailHog   → localhost:8025"

services-down: ## Stop Docker services
	docker compose down
	@echo "$(GREEN)✓ Services stopped$(RESET)"

services-reset: ## Stop and remove all volumes (destroys data)
	docker compose down -v
	@echo "$(YELLOW)⚠ All Docker volumes removed$(RESET)"

# ─── Database ─────────────────────────────────────────────────────────────────
migrate: ## Run database migrations
	@echo "$(CYAN)▶ Running migrations...$(RESET)"
	@npm run migrate -w packages/db

seed: ## Seed demo data
	@echo "$(CYAN)▶ Seeding demo data...$(RESET)"
	@npm run seed -w packages/db

reset: ## Reset database (drop schema, re-migrate, re-seed)
	@echo "$(YELLOW)▶ Resetting database...$(RESET)"
	@PGPASSWORD=constructpm_dev_password psql -h localhost -U constructpm -d constructpm_dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO constructpm;"
	@$(MAKE) migrate
	@$(MAKE) seed
	@echo "$(GREEN)✓ Database reset complete$(RESET)"

# ─── Development ──────────────────────────────────────────────────────────────
dev: ## Start both API and web app
	@echo "$(CYAN)▶ Starting ConstructPM (API + Web)$(RESET)"
	@echo "  API  → http://localhost:3001"
	@echo "  Web  → http://localhost:5173"
	@echo ""
	npm run dev

dev-api: ## Start API server only
	npm run dev -w packages/api

dev-web: ## Start web app only
	npm run dev -w packages/web

# ─── Utilities ────────────────────────────────────────────────────────────────
logs: ## Tail Docker service logs
	docker compose logs -f

db-shell: ## Open psql shell
	PGPASSWORD=constructpm_dev_password psql -h localhost -U constructpm -d constructpm_dev

redis-cli: ## Open Redis CLI
	docker exec -it constructpm-redis redis-cli -a constructpm_redis_dev

typecheck: ## Run TypeScript type check
	npm run typecheck

lint: ## Run ESLint
	npm run lint

clean: ## Remove node_modules and build artifacts
	find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "$(GREEN)✓ Cleaned$(RESET)"

# ─── MinIO bucket setup ───────────────────────────────────────────────────────
minio-setup: ## Create MinIO buckets (run once after services start)
	@docker run --rm --network constructpm-network \
	  -e MC_HOST_local=http://constructpm:constructpm_minio_dev@minio:9000 \
	  minio/mc mb local/constructpm-files local/constructpm-quarantine --ignore-existing 2>/dev/null || \
	  (docker run --rm -e MC_HOST_local=http://constructpm:constructpm_minio_dev@host.docker.internal:9000 \
	   minio/mc mb local/constructpm-files local/constructpm-quarantine --ignore-existing)
	@echo "$(GREEN)✓ MinIO buckets created$(RESET)"
