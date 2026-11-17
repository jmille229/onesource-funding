# Security incident response — One Source Funding

A short, practical plan for when something may have gone wrong: a leaked
password or key, a lost laptop with console access, an alert from error
tracking you don't understand, a client reporting something odd, or a
confirmed breach. **Have counsel review this before relying on it**; the
notification duties depend on your business and the states your clients are
in.

**Who's in charge:** the CEO decides; counsel advises on notification. Keep a running log (time, what you saw, what you did) from the
first minute — you'll need it later.

## What we hold, and how sensitive it is

| Data | Where | Sensitivity |
|---|---|---|
| Business EINs | database, encrypted (APPLICATION_DATA_KEY) | high |
| Uploaded documents (articles, W-9s, driver's licenses, invoices, approvals) | file storage bucket, encrypted at rest | **high** — driver's licenses are personal information under state breach laws |
| Funding ledger, invoices, agencies, contact names/emails/phones | database | business-confidential |
| Passwords | database, argon2 hashes only | low (hashes) |
| Two-step sign-in secrets | database, encrypted | medium |

Social Security numbers are **not** collected (removed November 2026; stored
ones were deleted).

## 1. Contain (first hour)

Do what applies; each is reversible.

- **Suspected stolen client login:** the client company's owner deactivates
  it in Settings → Team. That ends its sessions within 15 minutes. Then the
  user resets their password ("Forgot password") and turns on two-step
  sign-in. If the owner can't be reached, do it on the server (from
  `apps/constructpm`):

  ```sh
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
    psql -U constructpm -d constructpm -v email='person@client.com' <<'SQL'
  UPDATE users SET is_active = FALSE WHERE lower(email) = lower(:'email');
  UPDATE refresh_tokens SET is_revoked = TRUE
   WHERE user_id IN (SELECT id FROM users WHERE lower(email) = lower(:'email'));
  SQL
  ```
- **Suspected stolen operator login:** deactivate the account on the server
  with the same command, using `platform_users` in the first line and leaving
  out the second. The console stops accepting that operator's sign-ins at
  once, but a session that's already open lasts up to an hour. To cut it off
  sooner, rotate the signing keys (next item). Later, re-enable the account
  (`is_active = TRUE`) and reset its two-step sign-in with
  `./infra/reset-operator-2fa.sh <email>`.
- **A server secret leaked** (anything in `.env.production` or `secrets/`):
  rotate it — new value in `.env.production`, `./infra/deploy.sh`.
  - `JWT_SECRET` or the key pair in `secrets/`: move the old `jwt_*.pem`
    files aside, run `./infra/gen-jwt-keys.sh`, deploy. Signs everyone out.
  - Database passwords: `CONSTRUCTPM_APP_PASSWORD` / `FACTORING_ADMIN_PASSWORD`
    are re-applied on deploy.
  - Storage or backup bucket keys: revoke at the provider, issue new ones.
  - `APPLICATION_DATA_KEY`: don't just replace it — stored EINs and two-step
    secrets were encrypted with it. Ask for help re-encrypting.
- **Server compromise suspected:** take a backup (`./infra/backup.sh`), snapshot
  the server at the provider, then restrict it (provider firewall: SSH only
  from your IP) rather than deleting anything — evidence matters.

## 2. Assess (first day)

- **What and whose:** which data, which clients, what time window. Sources:
  - the operator audit log (console → Audit: every console action, including
    every EIN reveal);
  - API logs on the server (`docker compose … logs api`);
  - error tracking;
  - the storage provider's access logs.
- **Was it personal information?** Driver's licenses and EINs tied to a person
  usually are; business invoices usually aren't. Counsel decides.

## 3. Notify (as counsel advises)

- **Clients affected:** promptly, plainly — what happened, what data, what
  you've done, what they should do. Many state laws require notice to
  affected individuals "without unreasonable delay"; some set fixed deadlines
  (e.g. 30–60 days) and require notice to the state attorney general above a
  threshold.
- **If the FTC Safeguards Rule applies to you** (ask counsel), an event
  involving the unencrypted information of 500 or more consumers must be
  reported to the FTC within 30 days of discovery.
- **Your cyber/E&O insurer**, if you have one: many policies require prompt
  notice and provide breach counsel.

## 4. Recover and learn

- Restore anything damaged from backups (`./infra/restore.sh`; test-restore
  first with `verify`).
- Write down what happened, why, and what changes — within two weeks.

## Ahead of time (keep current)

- `.env.production`, `secrets/`, `APPLICATION_DATA_KEY` and `BACKUP_PASSPHRASE`
  in your password manager.
- Error tracking, uptime checks and backup pings sending to an inbox someone
  reads (DEPLOY.md → Monitoring).
- Two-step sign-in on every operator; required for client companies that
  want it.
- A monthly `./infra/restore.sh verify`.
