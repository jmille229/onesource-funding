# ConstructPM — Production Deployment Guide

## Prerequisites
- A Linux VPS or cloud VM (Ubuntu 22.04+) with Docker + Docker Compose installed
- A domain name pointed at your server
- Ports 80 and 443 open

---

## Step 1 — Generate JWT Keys

Run this once on any machine with `openssl` installed:

```bash
bash scripts/generate-jwt-keys.sh
```

Save the output `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in your secret manager.
**Delete the .pem files immediately after.**

---

## Step 2 — Set Up Managed Services (Recommended)

For production, use managed services instead of self-hosting databases:

| Service | Recommended Options |
|---------|---------------------|
| PostgreSQL | Supabase, Neon, Railway, AWS RDS |
| Redis | Upstash (serverless), Redis Cloud, Railway |
| Object Storage | AWS S3, Cloudflare R2, Backblaze B2 |
| Email | AWS SES, Resend, Postmark, SendGrid |

---

## Step 3 — Configure Environment

Copy `.env.production.example` to `.env.production` and fill in all values:

```bash
cp .env.production.example .env.production
# Edit .env.production — fill in every value
```

**Never commit `.env.production` to git.**

---

## Step 4 — Configure Domain

Edit `Caddyfile` and replace `yourdomain.com` with your actual domain:

```
yourdomain.com {
    ...
}
```

Caddy will automatically obtain a Let's Encrypt TLS certificate.

---

## Step 5 — Run Migrations

```bash
export $(cat .env.production | grep -v '#' | xargs)
npm run migrate
```

---

## Step 6 — Deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Check logs:
```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f caddy
```

---

## Step 7 — Verify

```bash
curl https://yourdomain.com/health
# → {"status":"ok","service":"constructpm-api",...}
```

---

## Updating Production

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
npm run migrate  # Run if there are new migrations
```

---

## Platform-Specific Guides

### Railway
1. Create a new project, add a PostgreSQL and Redis service
2. Deploy the API via `packages/api/Dockerfile`
3. Set all env vars in Railway's Variables tab
4. Railway auto-manages TLS

### Render
1. Create a Web Service pointing to `packages/api/Dockerfile`
2. Add a PostgreSQL database and Redis instance
3. Set env vars in the Environment tab

### Fly.io
```bash
fly launch --dockerfile packages/api/Dockerfile
fly secrets set DATABASE_URL="..." JWT_PRIVATE_KEY="..." ...
fly deploy
```

### AWS (ECS + RDS + ElastiCache)
See `infra/` directory for Terraform configuration.
