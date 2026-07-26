# ConstructPM

Construction Project Management & Job Finance Platform — full-stack monorepo.

## Prerequisites

| Requirement | Version | Install |
|------------|---------|---------|
| Node.js | v20+ | [nodejs.org](https://nodejs.org) |
| Docker Desktop | Latest | [docker.com](https://docker.com) |
| npm | v10+ | Included with Node |

## Quick Start

```bash
# 1. Clone and enter the project
cd constructpm

# 2. First-time setup (installs deps, starts Docker, migrates DB, seeds data)
make setup

# 3. Start the application
make dev
```

That's it. Open **http://localhost:5173**

**Demo login:**
- Email: `admin@hartwell.com`
- Password: `demo1234`

---

## Services

After `make setup`, the following run in Docker:

| Service | URL | Purpose |
|---------|-----|---------|
| PostgreSQL | localhost:5432 | Primary database |
| Redis | localhost:6379 | Sessions, rate limiting, queues |
| MinIO | localhost:9000 | File storage (S3-compatible) |
| MinIO Console | http://localhost:9001 | File browser UI |
| MailHog | http://localhost:8025 | Catches all outbound email |

## Development Commands

```bash
make dev          # Start API + Web (hot reload)
make dev-api      # API only (port 3001)
make dev-web      # Web only (port 5173)
make services     # Start Docker services
make migrate      # Run DB migrations
make seed         # Re-seed demo data
make reset        # Full DB reset + reseed
make db-shell     # psql shell
make logs         # Docker service logs
```

## Architecture

```
constructpm/
├── packages/
│   ├── api/        Express API server (port 3001)
│   ├── web/        React SPA (port 5173, proxies /api to 3001)
│   ├── db/         Migrations + seed data
│   └── shared/     TypeScript types shared between api and web
├── docker-compose.yml
├── Makefile
└── .env.local      All dev environment variables
```

## Tech Stack

**Backend:** Node.js 20, Express, TypeScript, PostgreSQL 16, Redis 7  
**Frontend:** React 18, Vite, TailwindCSS, TanStack Query, Zustand  
**Infrastructure (local):** Docker Compose, MinIO, MailHog  
**Security:** Argon2id passwords, JWT RS256, Row-Level Security (RLS), Zod validation

## Database

The schema is in `packages/db/migrations/V001__initial_schema.sql`.

All tables use PostgreSQL Row-Level Security — every query is automatically scoped to the authenticated company. The migration runner tracks applied versions in `schema_migrations`.

```bash
# Connect directly to the database
make db-shell

# Run migrations manually
make migrate

# Reset everything and re-seed
make reset
```

## Environment Variables

All variables have working defaults in `.env.local` for local development. **Never commit real secrets.**

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_PRIVATE_KEY` — JWT signing secret (change in production)
- `S3_ENDPOINT` — Points to MinIO locally, AWS S3 in production

## Feature Flags

The following features are mocked/disabled in local dev mode:
- **Virus scanning** (`SKIP_VIRUS_SCAN=true`) — files are marked clean immediately
- **Stripe** — use `sk_test_*` key from Stripe dashboard for real testing
- **Email** — all email goes to MailHog at http://localhost:8025

## Seeded Demo Data

After `make seed`, you have:

- **Company:** Hartwell Construction Group
- **Users:** admin@hartwell.com / demo1234 (owner role)
- **Jobs:** 3 sample jobs in various states
- **Budget items, tasks, contacts, and invoices** per job

## Production Deployment

See `infra/` for Terraform infrastructure-as-code targeting AWS (ECS, RDS Aurora, ElastiCache, S3).

For production:
1. Set `NODE_ENV=production`
2. Use real RSA keys for JWT (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`)
3. Point `DATABASE_URL` to RDS Aurora PostgreSQL
4. Set real Stripe keys
5. Configure SES for email (`SMTP_HOST`)
