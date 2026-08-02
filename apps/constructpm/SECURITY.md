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
