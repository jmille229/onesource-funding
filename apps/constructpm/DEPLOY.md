# Deploying ConstructPM — Turnkey single VPS

This is the push-button path: one Ubuntu VPS, one `docker compose` command, and
Caddy provisions HTTPS for you. Postgres, Redis, the API, the web bundle and the
reverse proxy run from `docker-compose.prod.yml`. Uploaded files go to a managed
storage bucket and backups to another, both encrypted (see "File storage" and
"Backups"). Before real customers: work through the **Launch checklist** below.

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
3. **Redis** comes up password-protected. (Uploaded files go to your storage
   bucket — see "File storage". With `S3_ENDPOINT` unset, the legacy in-stack
   MinIO starts instead.)
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

`deploy.sh` runs the exact build CI made for the commit you pulled (it stops
and says so if CI hasn't finished publishing it), backs the database up before
any migration, and records each deploy in `deploys.log`.

**Roll back** to the build that was running before:

```bash
./infra/deploy.sh --rollback
```

That changes the code, not the database (migrations only go forward). If a
migration itself has to be undone, restore the backup `deploy.sh` took first:
`./infra/restore.sh db backups/db-<stamp>.sql.gz.enc`.

### Turning on the factoring console

The operator console is off unless you configure it, so a deployment that doesn't
run factoring holds no cross-tenant credential at all.

1. Add a password to `.env.production` — this gives the `constructpm_factoring_admin`
   database role a login:

```bash
echo "FACTORING_ADMIN_PASSWORD=$(openssl rand -hex 24)" >> .env.production
```

2. Redeploy so the migration applies it and the API mounts `/api/admin`:

```bash
./infra/deploy.sh
```

3. Create an operator account. There is no self-registration for operators —
   these accounts reach factoring data across every client, so they are
   provisioned by hand:

```bash
./infra/create-operator.sh ops@os-funding.com "Jane Doe"
```

Sign in at `https://app.os-funding.com/admin`. Operator credentials are entirely
separate from client logins: different table, different token audience, and a
database role that can reach the factoring tables and nothing else — not jobs,
budgets, daily logs or subcontracts.

### Turning on the funding application (apply.os-funding.com)

Prospects apply for funding at `https://apply.os-funding.com` without an
account; applications land under **Applications** in the operator console, and
approving one creates the client's company, their login and an active funding
client in one step. It needs the factoring console (above) and three things:

1. **DNS.** Add an `A` record for `apply` pointing at the VPS (the same IP as
   `app`). Caddy fetches the certificate by itself once the record resolves.

2. **The encryption key** for applicants' EINs and everyone's two-step sign-in
   secrets (the console requires it). Generate it once and add it to
   `.env.production`:

```bash
echo "APPLICATION_DATA_KEY=$(openssl rand -base64 32)" >> .env.production
grep APPLICATION_DATA_KEY .env.production   # copy this value into your password manager
```

   Keep a copy somewhere other than the server. If the key is lost, the numbers
   already stored can't be read (applicants would have to re-enter them); if it
   leaks, generate a new one and ask open applicants to re-enter theirs. Without
   the key the application is switched off and says to call instead.

3. **Redeploy** — this applies the migration and starts the apply site:

```bash
./infra/deploy.sh
```

`APPLY_DOMAIN` defaults to `apply.os-funding.com`; set it in `.env.production`
to use another host. Email is optional: when SMTP isn't set up, every link an
applicant or client needs (their application link, a request for more documents,
the set-password link on approval) is shown on screen in the console to copy and
send yourself.

On the apply host only `/api/apply/*` reaches the API — login, client and
operator routes answer 404 there.

### Launch checklist

Do these once, before real customers. `sudo ./infra/launch-check.sh` shows
where each one stands and what to do next (it changes nothing); the console's
**System** tab shows most of them too.

1. **Secrets in your password manager** — a copy of `.env.production` and the
   two files in `secrets/`. Above all `APPLICATION_DATA_KEY` and
   `BACKUP_PASSPHRASE`: lose those and encrypted data can't be read.
2. **File storage off the server** — see "File storage" below.
3. **Off-site, encrypted backups, tested** — see "Backups" below, including
   `./infra/restore.sh verify`.
4. **Email** — see "Email" below: a Google mailbox connected in the System tab
   (or SMTP set), `OPS_NOTIFICATION_EMAIL` set, SPF, DKIM and DMARC records
   added; System → *Send me a test* arrives in the inbox (not spam).
5. **Two-step sign-in for every operator** — happens at each operator's first
   sign-in; save the recovery codes it shows.
6. **Monitoring** — an uptime check, error tracking, and the backup ping (see
   "Monitoring").
7. **Server hardening** — `sudo ./infra/harden.sh`, then `--apply`.
8. **Malware scanning** — optional on 4 GB, comfortable on 8 GB (see below).

### Email

**Google Workspace (recommended when your mail is at Google).** The app sends
through one of your mailboxes with the Gmail API. That's ordinary HTTPS, so it
works even though DigitalOcean blocks mail ports, and the app gets permission
to **send only**: it can't read the mailbox.

*A. Google Cloud, once (about 10 minutes, signed in as your Workspace admin):*

1. https://console.cloud.google.com → the project picker at the top → **New
   project**. Name it "One Source app", with Organization `os-funding.com` →
   **Create**, then make sure it's the selected project.
2. ☰ → **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. ☰ → **Google Auth Platform** (older screens call it *OAuth consent screen*)
   → **Get started**: app name "One Source", your address as support email,
   Audience **Internal**, your address as contact → **Create**. Internal means
   only os-funding.com accounts can use it, and Google doesn't need to review it.
4. **Clients → Create client**: type **Web application**, name "One Source
   app", and under **Authorized redirect URIs** add exactly
   `https://app.os-funding.com/api/mail/google/callback` → **Create**.
5. Copy the **Client ID** and **Client secret** into your password manager
   straight away; Google may not show the secret again.

*B. The server:*

```bash
sed -i -E '/^(GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET|SMTP_HOST|SMTP_PASS)=/d' .env.production
read -rp  "Google client ID: " ID;     echo "GOOGLE_OAUTH_CLIENT_ID=$ID" >> .env.production
read -rsp "Google client secret: " S; echo; echo "GOOGLE_OAUTH_CLIENT_SECRET=$S" >> .env.production; unset ID S
./infra/deploy.sh
```

*C. The console:* **System → Connect Google mailbox**. A Google window opens:
sign in as the mailbox the app should send from and press **Allow**. The
System tab shows "Sending … through Google" within a few seconds. Then **Send
me a test**.

*D. The From address.* `EMAIL_FROM` (e.g. `"One Source Funding
<noreply@os-funding.com>"`) must be the connected mailbox or one of its **Send
mail as** addresses; otherwise Gmail sends from the mailbox's own address. To
add `noreply@`: Google Admin → **Directory → Users →** the mailbox → **Alternate
email addresses** → add `noreply`; then in that mailbox's Gmail → ⚙ → **See all
settings → Accounts → Send mail as → Add another email address** (leave "Treat
as an alias" ticked).

*E. DNS*, so mail isn't marked as spam:
- **SPF**: one TXT record on `os-funding.com` starting `v=spf1`. It must contain
  `include:_spf.google.com`; edit the existing record, never add a second one.
  `sudo ./infra/launch-check.sh` prints the exact corrected value.
- **DKIM**: Google Admin → **Apps → Google Workspace → Gmail → Authenticate
  email** → **Generate new record** (2048-bit). Add the TXT record it shows
  (`google._domainkey`), wait an hour, press **Start authentication**.
- **DMARC**: TXT on `_dmarc.os-funding.com`: `v=DMARC1; p=none; rua=mailto:<you>`.
  After two clean weeks of reports, change `p=none` to `p=quarantine`.

Check: open the test email in Gmail → ⋮ → **Show original**: SPF, DKIM and
DMARC should all say PASS.

*If something goes wrong:*
- **"Access blocked" / "admin hasn't approved" on Google's screen**: Google Admin
  → **Security → Access and data control → API controls → Settings** → tick
  **Trust internal, domain-owned apps** → Save, then connect again.
- **The System tab says Google cancelled the permission**: Google does this when
  that account's password changes or its access is removed. Press **Reconnect**.
  Email stops until you do, and the console shows a banner.
- **"The Gmail API isn't turned on"**: step A2.
- **"redirect address isn't on the Google OAuth client"**: the URI in step A4
  must match exactly, including `https://` and no trailing slash.

**Other providers (SMTP).** Used only while no Google mailbox is connected:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` in
`.env.production` (Postmark, SendGrid, Amazon SES and others). DigitalOcean
blocks ports 25, 465 and 587 on many servers: check with
`timeout 5 bash -c '</dev/tcp/<smtp host>/587' && echo open || echo blocked`,
and if it's blocked use the provider's alternative port 2587 or 2525 (e.g.
Resend: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=2587`, `SMTP_USER=resend`,
`SMTP_PASS=<API key>`). Microsoft 365's password-based sending is being
switched off by default from the end of December 2026, so don't build on it.

### File storage

Uploaded documents belong in managed object storage: encrypted, versioned, and
not lost with the server. (The old in-stack MinIO can't be re-installed — its
image is no longer published — so a replacement server couldn't start it.)

1. Create a **private** bucket — Cloudflare R2, AWS S3, Backblaze B2 or
   DigitalOcean Spaces — with versioning on if offered, and an access key
   limited to that bucket.
2. Add the new bucket to `.env.production` as `NEW_S3_ENDPOINT`,
   `NEW_S3_REGION`, `NEW_S3_BUCKET_FILES`, `NEW_S3_ACCESS_KEY`,
   `NEW_S3_SECRET_KEY` (keep the current `S3_*` for now).
3. Copy and check:
   ```bash
   ./infra/migrate-files.sh          # copies (safe to re-run)
   ./infra/migrate-files.sh --check  # every file present?
   ```
4. Switch. Stop the API so nothing is uploaded during the last copy (about a
   minute offline), copy once more, point `S3_*` at the new bucket, deploy:
   ```bash
   C="docker compose --env-file .env.production -f docker-compose.prod.yml"
   $C stop api
   ./infra/migrate-files.sh && ./infra/migrate-files.sh --check
   cp .env.production secrets/env.before-new-storage     # to undo: copy it back, deploy
   NEWS3="$(sed -n -E 's/^NEW_(S3_(ENDPOINT|REGION|BUCKET_FILES|ACCESS_KEY|SECRET_KEY))=/\1=/p' .env.production)"
   sed -i -E '/^(NEW_)?S3_(ENDPOINT|REGION|BUCKET_FILES|ACCESS_KEY|SECRET_KEY|SERVER_SIDE_ENCRYPTION|FORCE_PATH_STYLE)=/d' .env.production
   printf '%s\nS3_SERVER_SIDE_ENCRYPTION=none\nS3_FORCE_PATH_STYLE=true\n' "$NEWS3" >> .env.production; unset NEWS3
   ./infra/deploy.sh
   ```
   `S3_SERVER_SIDE_ENCRYPTION=none` is for R2 and Spaces, which encrypt
   everything at rest themselves; for AWS use `AES256` and
   `S3_FORCE_PATH_STYLE=false`. Then open an existing invoice's attachment in
   the app to check downloads. The old files stay in the
   `constructpm_minio_data` volume until you delete it — wait a few weeks.

### Backups

`infra/backup.sh` dumps the database, archives `.env.production` and
`secrets/`, and copies uploaded files — all encrypted with `BACKUP_PASSPHRASE` —
keeps 14 days on the server and copies everything to an off-site bucket (35 days).

1. In `.env.production`: `BACKUP_PASSPHRASE` (`openssl rand -base64 32`, saved in
   your password manager), and `BACKUP_S3_*` for a bucket at a **different**
   provider or account than the files (e.g. Backblaze B2), so one leaked key
   can't delete both.
2. Free monitoring: create a check at https://healthchecks.io (daily, 1-hour
   grace), put its URL in `BACKUP_HEALTHCHECK_URL`. You get an email if a backup
   fails, doesn't run, or the disk passes 85%.
3. Run it once, then schedule it:
   ```bash
   ./infra/backup.sh
   sudo crontab -e
   # nightly at 3:15am:
   15 3 * * * cd /root/onesource-funding/apps/constructpm && ./infra/backup.sh >> /var/log/constructpm-backup.log 2>&1
   ```
4. **Test a restore** — now, and monthly:
   ```bash
   ./infra/restore.sh verify    # loads the newest backup into a scratch database, counts, drops it
   ```

Restoring for real (`./infra/restore.sh` with no arguments lists the options):

```bash
./infra/restore.sh list                                   # what's here and off-site
./infra/restore.sh db backups/db-<stamp>.sql.gz.enc        # replace the database
./infra/restore.sh files                                   # files from the off-site copy
```

**A new server from scratch:** install Docker and clone the repo (steps 1–2),
create `.env.production` with just `BACKUP_PASSPHRASE` and the `BACKUP_S3_*`
lines, then `./infra/restore.sh list`, `fetch` the newest `secrets-…` file and
`./infra/restore.sh secrets backups/secrets-….tar.gz.enc` to recover the real
`.env.production` and `secrets/`. Move them into place, `./infra/deploy.sh`,
then `./infra/restore.sh db …` and, if files lived on MinIO, `restore.sh files`.

### Monitoring

- **Uptime:** an external check (UptimeRobot, Better Stack, Healthchecks — all
  have free tiers) on `https://app.os-funding.com/health/ready` and
  `https://apply.os-funding.com/`, alerting you by email/SMS. `/health/ready`
  answers 200 only when the app can reach its database (the page itself
  always answers, so don't monitor `/` on this host).
- **Errors:** set `SENTRY_DSN` (a free Sentry project) and redeploy. Server
  errors, crashes and browser crashes are reported; no client data is sent.
- **Backups and disk:** the `BACKUP_HEALTHCHECK_URL` ping above.

### Malware scanning

Every upload is scanned with ClamAV and a flagged file can't be downloaded.
ClamAV holds its signature database in memory (~1.5 GB), so use it on a server
with at least 4 GB and preferably 8 GB:

```bash
# .env.production
CLAMAV_HOST=clamav
./infra/deploy.sh      # starts the clamav service; first signature download takes a few minutes
```

Check it in the console's System tab ("ClamAV answering"). To prove it blocks
malware, upload the harmless EICAR test file (eicar.org) as an invoice document
and try to download it — it should be refused.

### Server hardening

```bash
sudo ./infra/harden.sh           # shows what it would change
sudo ./infra/harden.sh --apply   # firewall (22/80/443), automatic security updates, fail2ban, key-only SSH
```

Key-only SSH is applied only when an SSH key is already installed, so it can't
lock you out. Add yours first (`ssh-copy-id root@<server>` from your Mac) and
check you can sign in with it.

### Operators and two-step sign-in

Every operator signs in with a password **and** a code from an authenticator
app. The first sign-in shows a QR code to set it up, then ten recovery codes —
save them. Lost phone and codes: `./infra/reset-operator-2fa.sh <email>` on the
server, and they set it up again at the next sign-in.

Client users turn two-step sign-in on themselves (Account page), and a company
owner can require it for their whole company (Settings). A client user who
lost their phone **and** their recovery codes: `./infra/reset-user-2fa.sh
<email>`. Call them back on a number you already have before you run it;
"I lost my phone, please turn it off" is exactly what someone taking over an
account would say.

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
| `minio`        | Legacy in-stack file storage (`minio` profile only)     | no      |
| `createbuckets`| One-shot MinIO bucket creation (`minio` profile only)   | no      |
| `clamav`       | Malware scanning of uploads (`clamav` profile only)     | no      |

Only Caddy is reachable from the internet. The browser calls `/api/*` on your
domain; Caddy routes those to the API and everything else to the SPA, so there's
no CORS and no second hostname to manage.

File downloads stream through the API rather than via presigned URLs, so every
download passes the malware check and the bucket stays entirely private. (Set
`S3_PUBLIC_ENDPOINT` to switch to short-lived presigned URLs instead.)

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
