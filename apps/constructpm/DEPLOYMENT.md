# ConstructPM — Production Deployment Guide

This guide covers deploying ConstructPM to cloud environments.
The stack is two Docker containers (API + Web) + managed PostgreSQL + managed Redis + S3.

---

## Prerequisites

- Docker & Docker Compose installed on your server
- A domain name with DNS pointing to your server
- Managed PostgreSQL (recommended: RDS, Supabase, Neon, Railway, or Render)
- Managed Redis (recommended: Upstash, Redis Cloud, or ElastiCache)
- S3-compatible storage (AWS S3, Cloudflare R2, or Backblaze B2)
- SMTP provider (AWS SES, SendGrid, Postmark, or Resend)

---

## Step 1 — Generate JWT Keys

Run this once on any machine with OpenSSL. Store the output in your secret manager.

```bash
bash scripts/generate-jwt-keys.sh
```

This creates `jwt_private.pem` and `jwt_public.pem`. Copy their contents into your
environment variables (see Step 3), then delete the files.

---

## Step 2 — Provision Cloud Services

### PostgreSQL
Create a database named `constructpm_prod` and a user `constructpm_app` with
a strong random password. Run the migrations:

```bash
DATABASE_URL="postgresql://constructpm_app:PASSWORD@your-host/constructpm_prod?sslmode=require" \
  npm run migrate
```

> The migration creates the `constructpm_app` role with RLS enforced.
> The V002 migration sets up database-level row-level security policies.

### S3 Bucket
Create a private S3 bucket (no public access). The API generates pre-signed
URLs for file access — the bucket must never be public.

Recommended bucket policy: deny all `s3:GetObject` without a signed URL.

### Redis
Any Redis 7+ instance works. Use TLS (`rediss://`) in production.

---

## Step 3 — Configure Environment Variables

Copy `.env.production.example` to understand what's needed.
Set all variables in your platform's secret manager — **never commit a filled `.env.production`**.

**Minimum required variables:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string with `?sslmode=require` |
| `REDIS_URL` | Redis URL (use `rediss://` for TLS) |
| `REDIS_PASSWORD` | Redis auth password |
| `JWT_PRIVATE_KEY` | Full RSA private key PEM (RS256 signing) |
| `JWT_PUBLIC_KEY` | Full RSA public key PEM (RS256 verification) |
| `JWT_ISSUER` | Your API domain, e.g. `https://api.yourdomain.com` |
| `S3_ACCESS_KEY` | S3/R2 access key |
| `S3_SECRET_KEY` | S3/R2 secret key |
| `S3_BUCKET_FILES` | Your private S3 bucket name |
| `S3_REGION` | S3 region |
| `APP_URL` | Your frontend URL, e.g. `https://yourdomain.com` |
| `SMTP_HOST` | SMTP server host |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `EMAIL_FROM` | Sender address |

---

## Step 4 — Edit Caddyfile

Open `Caddyfile` and replace `yourdomain.com` with your actual domain:

```
yourdomain.com {
    ...
}
www.yourdomain.com {
    redir https://yourdomain.com{uri} permanent
}
```

Caddy automatically provisions TLS certificates via Let's Encrypt — no manual cert management needed.

---

## Step 5 — Deploy

On your production server:

```bash
# Clone the repo
git clone https://github.com/your-org/constructpm.git
cd constructpm

# Create .env.production with all secrets (from your secret manager)
# Never commit this file — it's in .gitignore

# Build and start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Run migrations (first deploy only)
docker compose -f docker-compose.prod.yml exec api \
  node packages/db/dist/migrate.js

# Check everything is healthy
docker compose -f docker-compose.prod.yml ps
curl https://yourdomain.com/health
```

---

## Platform-Specific Guides

### Railway
1. Create a new project and connect your GitHub repo
2. Add PostgreSQL and Redis plugins
3. Set all environment variables in the Railway dashboard
4. Set build command: `npm run build` and start command: `npm start -w packages/api`
5. Set `PORT=3001` and deploy

### Render
1. Create a new Web Service from your repo
2. Build command: `npm ci && npm run build`
3. Start command: `node packages/api/dist/server.js`
4. Add a PostgreSQL and Redis instance from the Render dashboard
5. Set environment variables

### Fly.io
```bash
fly launch --dockerfile packages/api/Dockerfile
fly secrets set DATABASE_URL="..." JWT_PRIVATE_KEY="..."
fly deploy
```

### AWS (ECS + RDS + ElastiCache)
Use the provided Dockerfiles with ECR. Set secrets via AWS Secrets Manager
and inject them as environment variables in your task definition.
Enable RDS Proxy for connection pooling.

---

## Post-Deployment Checklist

- [ ] HTTPS is enforced (Caddy/load balancer handles TLS)
- [ ] `curl https://yourdomain.com/health` returns `{"status":"ok"}`
- [ ] `curl https://yourdomain.com/api/health/ready` returns `{"status":"ready"}`
- [ ] Login works end-to-end
- [ ] File upload and download work (pre-signed URLs reaching S3)
- [ ] Emails are being sent (check SMTP logs)
- [ ] Redis rate limiting is active (check API logs for `RateLimiterRedis`)
- [ ] Database RLS is active (V002 migration ran successfully)
- [ ] `npm audit --audit-level=high` reports no vulnerabilities
- [ ] Rotate the seed data credentials (or delete demo company)

---

## Maintenance

### Rotate JWT Keys
Generate new keys, update `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in your
secret manager, then redeploy. All existing sessions will be invalidated
(users will be prompted to log in again).

### Database Backups
Enable automated backups on your managed PostgreSQL provider. Test restores
regularly. Point-in-time recovery (PITR) is recommended for production.

### Monitoring
- API health: `GET /health` and `GET /health/ready`
- Application logs: structured JSON (pino) — ship to Datadog, Grafana Loki, or CloudWatch
- Error tracking: add a `SENTRY_DSN` env var and integrate `@sentry/node` in `server.ts`

### Scaling
- The API is stateless — run multiple instances behind a load balancer
- Rate limiting uses Redis — shared across all instances automatically
- Use `DATABASE_READER_URL` to point read queries at a read replica
