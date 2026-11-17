# ConstructPM — security notes

## Tenant isolation

Every tenant table has Row-Level Security **enabled and forced**, with `USING`
and `WITH CHECK` clauses keyed on `current_company_id()`. The API connects as
`constructpm_app`, a non-owner role with no `BYPASSRLS`, so isolation is enforced
by Postgres rather than by application code. With no tenant set, every policy
evaluates false — it fails closed.

`packages/api/src/lib/rls.test.ts` asserts this against a real database in CI:
read scoping, IDOR by known id, fail-closed, and rejected cross-tenant
insert/update/delete.

Migrations run as the owner role (`constructpm`), which *does* bypass RLS —
that is required to create roles, policies and `SECURITY DEFINER` functions.
Never point `DATABASE_URL` at the owner role.

## Writing new endpoints

**Dynamic `UPDATE` statements must go through `buildUpdateSet`**
(`packages/api/src/lib/sql.ts`). Column names cannot be parameterized in SQL, so
interpolating `Object.keys(req.body)` into a SET clause is a SQL-injection sink.
This was a real, confirmed vulnerability in the daily-logs PATCH handler: the
payload

```json
{"summary=(SELECT password_hash FROM users LIMIT 1), notes": "x"}
```

executed as SQL and copied a password hash into a readable field. Any
authenticated user, down to the `field_crew` role, could run it. RLS contained it
to the caller's own tenant, but it was still privilege escalation.

`buildUpdateSet` emits identifiers only from a hard-coded allowlist. There is a
regression test using that exact payload.

## Dependency advisories

Run `npm audit` from `apps/constructpm`. CI reports the audit on every run and
fails on **critical**; high and below are reported but not blocking, so an
unreachable advisory in a transitive package cannot wedge the pipeline.

### Accepted: react-router RSC Mode CSRF Bypass (high)

`react-router` carries two overlapping advisories that, together, cover every
published version:

| Advisory | Affected | Reachable here? |
|---|---|---|
| Open redirect via backslash in `<Link>` / `useNavigate` | ≤ 7.17.0 | **Yes** — we use these APIs |
| RSC Mode CSRF Bypass | 7.12.0 – 8.2.0 | **No** |

There is no version clear of both (`react-router-dom` has no 8.x release). We run
**7.18.2**, which fixes the reachable open redirect.

The remaining RSC advisory does not apply: it requires React Router's React
Server Components mode, with a server runtime and server actions. ConstructPM
ships a static client-side bundle served by nginx, using `BrowserRouter` — there
is no RSC, no loader/action server, and no server-side route handling.

Revisit when a `react-router-dom` release lands above 8.2.0.

## Runtime

Node **22 LTS** (supported to April 2027). Node 20 reached end-of-life in April
2026 and no longer receives security patches — do not move the Docker images or
CI back to it.

## Secrets

- Access tokens are signed RS256; the private key is mounted as a file from
  `./secrets`, never held in an environment variable or committed.
- `.env.production` and `secrets/` are gitignored and exist only on the server.
- Rotate the database application credential by changing
  `CONSTRUCTPM_APP_PASSWORD` and redeploying — the migrate step applies it.

## Review — September 2026

Full read of the API, migrations, web clients, Docker/Caddy/nginx stack and
the marketing site, from a security and scalability standpoint. Tenant
isolation held everywhere it was checked: every table created after V002 has
RLS enabled **and forced**, and V004–V006 explicitly revoke the DML that
V002's `ALTER DEFAULT PRIVILEGES` would otherwise have handed the tenant role
on platform-level tables. Auth is sound (argon2id, RS256 enforced in
production, rotating refresh tokens with family revocation, separate admin
audience). The findings below are what was wrong around that core.

### Fixed in this review

| Sev | Finding | Where |
|---|---|---|
| **High** | Deactivating a user did not end their session. `auth_find_refresh_token` did not check `is_active`/`deleted_at`, so a revoked user's cookie kept minting access tokens for up to 90 days. | V009; `settings.router` deactivate now also revokes the user's tokens in the same transaction |
| **High** | A Redis restart became a permanent outage. ioredis stopped reconnecting after five attempts, and the rate-limit middleware treated *any* rejection as "over limit" — every request 429'd until the API was restarted. | `lib/redis.ts` (never-give-up backoff, `enableOfflineQueue: false`); `middleware` (`insuranceLimiter` memory fallback; only `RateLimiterRes` is a 429, infra errors fail open) |
| **High** | Upload concurrency slot leak. A multipart body with no file part never settled the handler promise, so `activeUploads` was never decremented; ten such requests made `/files/upload` return 503 permanently. | `files.router` — reject on `finish` with no file; settle on client abort |
| **High** | Unbounded list queries on 12 endpoints; jobs pagination accepted `per_page=999999999` and `page=0` (negative OFFSET → 500). | `lib/pagination.ts` (`parsePagination` clamps; `escapeLike` neutralises `%`/`_`); applied to every list handler |
| **High** | `GET /settings/company` bypassed the RLS client, so RLS saw a NULL tenant and returned nothing — the endpoint answered `{ data: undefined }` for every tenant. Fail-closed, not a leak, but broken. | `settings.router` |
| Med | Register issued no refresh cookie: a new tenant was logged out 15 minutes after signing up with nothing for silent refresh to use. | `auth.router` — `issueSession()` shared by login and register |
| Med | `/auth/refresh` had no rate limit (one DB read + two writes per unauthenticated call). | `refreshRateLimit`, 60/min/IP |
| Med | `entity_type`/`entity_id` on upload were unvalidated and interpolated into the S3 key. | `files.router` — allowlist + UUID check, on upload and list |
| Med | Downloads read `mime_type`; the column is `content_type`, so every file went out as `application/octet-stream`. | `files.router` |
| Med | nginx `add_header` is not inherited into location blocks that set their own, so the CSP and every other security header were dropped for `index.html` and all assets. Caddy re-added four of them; CSP and Permissions-Policy were absent in production. | Headers moved to `Caddyfile` (single source, per-handle so the API's own CSP is untouched); nginx no longer sets any |
| Med | No response compression for API JSON; no request-body cap at the edge. | `Caddyfile` — `encode zstd gzip`, `request_body max_size 60MB` |
| Med | `minio/minio:latest` and `minio/mc:latest` unpinned — a deploy could pull a new major with a changed on-disk format. `nginx:1.25` is out of support. | Pinned to dated releases; nginx 1.28 |
| Med | Postgres, Redis and MinIO had no memory limits; Postgres had the 64 MB default `/dev/shm`; Redis had no `maxmemory`. | `docker-compose.prod.yml` |
| Med | The 30 s request deadline sent a 503 but could not stop the query — the connection stayed busy until Postgres finished on its own. | `statement_timeout` 25 s and `idle_in_transaction_session_timeout` 30 s on every pool |
| Med | `settings` PATCH accepted `z.record(z.unknown())` — arbitrary JSON up to 2 MB merged into the JSONB column. | Bounded `companySettingsSchema` |
| Med | Job / subcontract numbers were `COUNT(*)+1`, which drifts from the max as soon as a number is supplied by hand and then collides with the UNIQUE constraint as a 500. | MAX-of-suffix generation; 23505 → 409 |
| Med | The marketing site (Cloudflare Workers assets) shipped no security headers at all. | `public/_headers` — CSP, HSTS, frame-ancestors, etc. Verified: production build has zero inline scripts |
| Low | `subcontracts` PATCH built its SET clause from `Object.keys(body)` — safe only because Zod strips unknown keys, and contrary to the rule above. | Routed through `buildUpdateSet` |
| Low | ILIKE searches did not escape `%`/`_` and had no length cap. | `escapeLike` |
| Low | Unknown enum values in `?status=` filters surfaced as 500s from the Postgres cast. | Validated → 422 (jobs, admin advances) |
| Low | `seed.ts` would happily create a `demo1234` owner account against a production database. | Refuses when `NODE_ENV=production` |
| Low | `schema_migrations` inherited the default DML grant to the tenant role. | Revoked in V009 |

### Known and accepted / operator actions

- ~~**Backups stay on the VPS.**~~ Resolved November 2026: `infra/backup.sh`
  encrypts and copies off-site (see below and DEPLOY.md → Backups).
- **CI audit level stays at `critical`.** Bumping to `high` would fail on the
  react-router RSC advisory documented above, which is accepted as unreachable.
- **`trust proxy` is `1`.** Correct for Caddy-only. If Cloudflare is ever put
  in front of the VPS it must become `2` (or Caddy must be told to trust
  CF's ranges), or every rate limit keys on Cloudflare's IPs.
- **List endpoints now cap, they do not page** — except invoices, which page
  on the server as of November 2026 (the tenant table that grows fastest).
  Other caps (200 rows; 500 for a job's tasks and the factoring lists; 1000
  for reports and the operator's book) are above anything a tenant holds today.
- **A role change takes effect on the next refresh, up to 15 minutes.** The
  access token carries the role; refresh re-reads it from the database. Fine
  for a downgrade from admin to viewer; not fine if immediate lock-out is
  ever required — deactivate instead, which is immediate as of V009.
- ~~**Registration has no email verification.**~~ Resolved November 2026.
- ~~**`/api/admin/*` is not behind a rate limit.**~~ Resolved November 2026
  (600/min per operator).
- ~~**The 30 s request deadline and large imports.**~~ Resolved November 2026:
  uploads and the operator import get 5 minutes.

## Review — November 2026 (pre-launch)

A production-readiness pass before real client data. Changes:

| Area | Change | Where |
|---|---|---|
| Data minimisation | **Social Security numbers are no longer collected.** The apply flow asks for the business EIN only. V019 deleted every stored SSN and CHECK constraints refuse new ones. Backups taken before V019 still hold encrypted copies until they age out. | V019; `apply` module and UI |
| Account recovery | **Password reset** by email: single-use, 1-hour link (stored as a SHA-256 hash), at most one per minute per account, the request always answers the same way whether or not the address exists, and a reset signs every session out and voids other outstanding links. | V020 `auth_request_password_reset`, `auth_accept_invite`; `security.router` |
| Account takeover | **Two-step sign-in** (TOTP, RFC 6238, ±30 s, each code usable once) with ten single-use recovery codes (SHA-256 hashed). Secrets are encrypted with `APPLICATION_DATA_KEY`. Optional for client users; a company owner can require it for the whole company (only after turning it on themselves). **Mandatory for operators** — the first console sign-in after deploy sets it up. Code checks are limited to 6 per 5 minutes per account. Lost device and codes: `infra/reset-operator-2fa.sh` / `infra/reset-user-2fa.sh` on the server, after confirming identity by calling back a known number. | V020; `lib/mfa.ts`, `modules/auth/session.ts`, `security.router`, `admin.router` |
| Signup abuse | Email verification (7-day link) before a self-registered company can submit a funding application; honeypot field and a minimum fill time on register; re-sends limited to 5/hour per address. | V020; `auth.router`, `factoring.router` |
| Malicious uploads | **ClamAV scanning** (optional `clamav` profile). Every upload is scanned in the background and every download path re-checks a cached verdict; infected files are refused with 422 and never served. | `lib/scanner.ts`, `lib/storage.ts`; V021 `file_scans` |
| Files at rest | Production file storage moves off the self-hosted MinIO to a managed S3-compatible bucket with provider-side encryption; `infra/migrate-files.sh` copies and checks. MinIO stays available behind the `minio` profile. | `docker-compose.prod.yml`; DEPLOY.md → File storage |
| Backups | Nightly database + files + secrets, encrypted on the server (AES-256, PBKDF2 200k) with `BACKUP_PASSPHRASE`, copied off-site with rclone, success pinged to a health check. Deploys take a database backup before migrating. `infra/restore.sh verify` test-restores into a throwaway database. | `infra/backup.sh`, `infra/restore.sh`, `infra/deploy.sh` |
| Deploys | `deploy.sh` pins the exact image build, records it, and `--rollback` returns to the previous one. | `infra/deploy.sh` |
| Visibility | Optional Sentry error tracking (server and browser; no request bodies, cookies or user details sent); browser errors relayed through the API, limited to 30 per 10 minutes per IP. A startup warning and a console banner when email isn't configured; console System tab with service status and a test email. | `lib/monitoring.ts`, `telemetry.router`, `SystemPanel` |
| Operator API | Per-operator limit of 600 requests/min. | `middleware` `operatorRateLimit` |
| Server | `infra/harden.sh`: firewall (22/80/443 only), SSH keys only, unattended security updates, fail2ban. Shows what it would change unless run with `--apply`. | `infra/harden.sh` |
| Incident plan | A written response plan, for counsel review. | `INCIDENT_RESPONSE.md` |

### Known and accepted

- **Malware scanning fails open.** If clamd is down, uploads still succeed and
  downloads are served; the file is scanned when the scanner is back and any
  later download is refused if it's infected. The console System tab shows
  when the scanner is down.
- **An open operator session survives deactivation for up to an hour.** The
  operator token isn't re-checked against the database on every request.
  Rotate the signing keys to cut every session off at once
  (INCIDENT_RESPONSE.md).
- **Two-step sign-in has no SMS or email fallback,** deliberately: both are
  weaker than an authenticator app. Recovery codes are the fallback.
- **The scripts in `infra/` that touch outside services** (rclone, the ClamAV
  image, `harden.sh`, `migrate-files.sh`) were checked for syntax and run
  locally where possible, not against the production server. Run each once
  by hand as DEPLOY.md's launch checklist describes.
- **Consent wording** on the application still authorises personal credit
  reports on the owners. With no SSN collected, have counsel confirm the
  wording and how owner checks are run.
