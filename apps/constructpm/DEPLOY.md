# Deploying ConstructPM — Turnkey single VPS

This is the push-button path: one Ubuntu VPS, one `docker compose` command, and
Caddy provisions HTTPS for you. The whole stack — Postgres, Redis, MinIO (S3),
the API, the web bundle, and the reverse proxy — runs from
`docker-compose.prod.yml`. No managed cloud services required.

Target: **https://app.os-funding.com** (swap in your own domain anywhere you see it).

---

## 0. What you need first

- A VPS with **2 vCPU / 4 GB RAM** or better, running Ubuntu 22.04/24.04.
- A **domain** with a DNS **A record** pointing at the VPS's public IP.
  For `app.os-funding.com`, add an A record for `app` → `<your-vps-ip>`.
- Ports **80** and **443** open in the firewall.

---

## 1. Install Docker on the VPS

```bash
ssh root@<your-vps-ip>
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

---

## 2. Get the code onto the server

```bash
git clone https://github.com/jmille229/onesource-funding.git
cd onesource-funding/apps/constructpm
```

---

## 3. Create the config and secrets

**a) Environment file** — copy the example and fill it in:

```bash
cp .env.production.example .env.production
openssl rand -base64 36        # run once per secret to generate strong values
nano .env.production           # set DOMAIN + paste the generated secrets
```

At minimum set: `DOMAIN`, `POSTGRES_PASSWORD`, `CONSTRUCTPM_APP_PASSWORD`,
`REDIS_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and a `JWT_SECRET` of at
least 64 characters. `.env.production` is gitignored — it never leaves the server.

**b) JWT signing keys** — generate the RS256 key pair (written to `./secrets`,
which is gitignored and mounted read-only into the API container):

```bash
./infra/gen-jwt-keys.sh
```

---

## 4. Launch

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

First boot does everything automatically:

1. **Postgres** initializes, then `infra/db-init.sh` applies every migration
   (`packages/db/migrations/V*.sql`) and sets the `constructpm_app` role password.
2. **MinIO** starts and `createbuckets` creates the files bucket.
3. **Redis** comes up password-protected.
4. **API** waits for all three to be healthy, then starts.
5. **Caddy** requests a Let's Encrypt certificate for your domain and serves HTTPS.

Watch it come up:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Give Caddy a minute to obtain the TLS cert, then visit **https://app.os-funding.com**.

---

## 5. Verify

```bash
# API health (through Caddy, over HTTPS)
curl https://app.os-funding.com/health

# container status — all 'running'/'healthy' except createbuckets ('exited (0)')
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Then open the site and register the first account.

---

## Day-2 operations

**Update to the latest code:**

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The DB init script only runs on an **empty** data directory. To apply a migration
added after first boot, run it against the live database as the superuser:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres psql -U constructpm -d constructpm < packages/db/migrations/V00X__whatever.sql
```

**Back up the database:**

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres pg_dump -U constructpm constructpm | gzip > backup-$(date +%F).sql.gz
```

**Back up uploaded files:** they live in the `minio_data` Docker volume — snapshot
it or `mc mirror` to an off-box bucket.

**Stop / start (keeps your data):**

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Data lives in named volumes, so `down` is safe. Only `down -v` deletes it — don't
run that unless you mean to wipe everything.

---

## How the pieces fit

| Service        | Role                                                    | Public? |
|----------------|---------------------------------------------------------|---------|
| `caddy`        | TLS termination + reverse proxy                         | 80/443  |
| `web`          | React SPA served by nginx                               | no      |
| `api`          | Express API (connects to Postgres as `constructpm_app`) | no      |
| `postgres`     | Tenant data with Row-Level Security                     | no      |
| `redis`        | Sessions, rate limiting                                 | no      |
| `minio`        | S3-compatible file storage                              | no      |
| `createbuckets`| One-shot bucket creation, then exits                    | no      |

Only Caddy is reachable from the internet. The browser calls `/api/*` on your
domain; Caddy routes those to the API and everything else to the SPA, so there's
no CORS and no second hostname to manage.

### Security notes

- The API connects as **`constructpm_app`**, a non-owner role subject to
  Row-Level Security — tenant isolation holds even if application code has a bug.
- Access tokens are signed with **RS256**; the private key is a mounted file,
  never an environment variable or a value in git.
- Secrets live only in `.env.production` and `./secrets/` on the server, both
  gitignored.
