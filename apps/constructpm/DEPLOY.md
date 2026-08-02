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

## 2b. Make sure the server can pull the images

CI publishes `constructpm-api`, `constructpm-web` and `constructpm-migrate` to
GitHub Container Registry. Packages published by Actions start **private** even
when the repository is public, so pick one:

**Either** make them public (no credentials on the server) — for each package at
`https://github.com/users/jmille229/packages/container/<name>/settings`, under
*Danger Zone* choose **Change visibility → Public**.

**Or** log the server in to GHCR with a token that has `read:packages`:

```bash
echo "<YOUR_TOKEN>" | docker login ghcr.io -u jmille229 --password-stdin
```

If you skip this, `./infra/deploy.sh` fails at the pull step with `denied` or
`unauthorized`.

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
./infra/deploy.sh
```

That pulls the images CI published, runs migrations, starts everything, and waits
for the API to report healthy. First boot:

1. **Postgres** starts.
2. **migrate** applies every migration and provisions the `constructpm_app` role.
3. **Redis** comes up password-protected; **MinIO** starts and `createbuckets`
   creates the files bucket.
4. **API** starts — only after migrations succeeded.
5. **Caddy** requests a Let's Encrypt certificate and serves HTTPS.

> **No images published yet?** If CI hasn't run on `main` yet, build locally once:
> `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`
> (~10 min on a small VPS). Every deploy after that uses `./infra/deploy.sh`.

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

### Shipping a change

1. Push to `main` (or merge a PR). CI typechecks, runs the tests — including
   tenant-isolation tests against a real Postgres — and publishes new images.
2. On the VPS:

```bash
cd onesource-funding && git pull
cd apps/constructpm && ./infra/deploy.sh
```

Takes about 30 seconds. Migrations are applied automatically as part of the
deploy: the one-shot `migrate` service runs `packages/db/migrations/V*.sql`,
skipping anything already recorded in `schema_migrations`, and the API refuses to
start until it succeeds. Adding a migration means dropping a new
`V00X__name.sql` in that folder — nothing else to wire up.

**Roll back** to any previous build by pinning its commit SHA:

```bash
IMAGE_TAG=a1b2c3d ./infra/deploy.sh
```

### Backups

```bash
chmod +x infra/backup.sh
sudo crontab -e
# nightly at 3am:
0 3 * * * /root/onesource-funding/apps/constructpm/infra/backup.sh >> /var/log/constructpm-backup.log 2>&1
```

Dumps the database and mirrors uploaded files into `./backups`, pruning after 14
days. That covers application mistakes but **not** losing the VPS itself — copy
`./backups` off-box (S3, Backblaze, rsync elsewhere) for real durability.

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
| `migrate`      | One-shot schema migration on each deploy, then exits    | no      |
| `redis`        | Rate limiting, caching                                  | no      |
| `minio`        | S3-compatible file storage                              | no      |
| `createbuckets`| One-shot bucket creation, then exits                    | no      |

Only Caddy is reachable from the internet. The browser calls `/api/*` on your
domain; Caddy routes those to the API and everything else to the SPA, so there's
no CORS and no second hostname to manage.

File downloads stream through the API rather than via presigned URLs, because
MinIO is private to the Docker network and a presigned `http://minio:9000/...`
URL resolves for the API container and for nobody else. If you later move to real
S3 or expose MinIO on its own hostname, set `S3_PUBLIC_ENDPOINT` and the API
switches back to presigned URLs automatically.

### Security notes

- The API connects as **`constructpm_app`**, a non-owner role subject to
  Row-Level Security — tenant isolation holds even if application code has a bug.
  Seven tests in CI assert this against a real database on every push.
- Access tokens are signed with **RS256**; the private key is a mounted file,
  never an environment variable or a value in git.
- Secrets live only in `.env.production` and `./secrets/` on the server, both
  gitignored.
- Dynamic `UPDATE` statements go through `buildUpdateSet` (`packages/api/src/lib/sql.ts`),
  which only emits column names from a hard-coded allowlist. Use it for any new
  PATCH endpoint — interpolating `Object.keys(req.body)` into SQL is a confirmed
  injection vector, and there is a regression test for it.
