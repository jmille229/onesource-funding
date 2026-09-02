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

- **Backups stay on the VPS.** `infra/backup.sh` protects against application
  mistakes, not against losing the box. Copy `./backups` off-host nightly
  (S3/Backblaze/rsync). This is the largest remaining single point of failure.
- **CI audit level stays at `critical`.** Bumping to `high` would fail on the
  react-router RSC advisory documented above, which is accepted as unreachable.
- **`trust proxy` is `1`.** Correct for Caddy-only. If Cloudflare is ever put
  in front of the VPS it must become `2` (or Caddy must be told to trust
  CF's ranges), or every rate limit keys on Cloudflare's IPs.
- **List endpoints now cap, they do not page.** Defaults (200 rows; 500 for a
  job's tasks and the factoring lists; 1000 for reports and the operator's
  book) are above anything a tenant holds today, and clients may pass
  `?per_page=`. Real paging in the UI is a product change and a follow-up.
- **A role change takes effect on the next refresh, up to 15 minutes.** The
  access token carries the role; refresh re-reads it from the database. Fine
  for a downgrade from admin to viewer; not fine if immediate lock-out is
  ever required — deactivate instead, which is immediate as of V009.
- **Registration has no email verification.** Rate-limited to 10/min/IP.
  Acceptable for a B2B tool whose tenants are onboarded by an operator anyway;
  revisit if self-serve signup is ever marketed.
- **`/api/admin/*` is not behind `tenantRateLimit`.** A single trusted operator
  account today. Add a per-operator limiter before there are many.
- **The 30 s request deadline and large imports.** A ~400-row workbook import
  runs ~2,000 statements in one transaction and may approach the deadline.
  `statement_timeout` is per statement so it will not fire; if the deadline
  does, chunk the import.
