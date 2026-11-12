/**
 * Funding applications (V013) are reached by people with no account, through a
 * resume token. These tests pin the database boundaries that make that safe,
 * connecting as the same roles the API uses:
 *
 *   constructpm_app             — the applicant, scoped by app.application_id
 *   constructpm_factoring_admin — the operator console
 *
 * Skips itself without TEST_DATABASE_URL / TEST_APP_DATABASE_URL, like the
 * other database suites; the operator checks also need TEST_ADMIN_DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'crypto';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const ADMIN_URL = process.env['TEST_ADMIN_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const SCHEDULE = 'f0000000-0000-0000-0000-0000000013aa';
const EXISTING_CO = 'f1300000-0000-0000-0000-000000000001';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const unique = () => randomUUID().slice(0, 8);

let owner: pg.Pool;
let app: pg.Pool;
let admin: pg.Pool | null = null;
const created: string[] = [];
const createdCompanies: string[] = [EXISTING_CO];

/** As the API's applicant session: app role, one application in scope. */
async function asApplicant<T extends pg.QueryResultRow = pg.QueryResultRow>(
  applicationId: string | null, sql: string, params: unknown[] = [],
): Promise<T[]> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    if (applicationId) await c.query(`SELECT set_config('app.application_id', $1, true)`, [applicationId]);
    const r = await c.query<T>(sql, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Start an application the way POST /api/apply/start does. */
async function startApplication(opts: { email?: string; token?: string } = {}) {
  const id = randomUUID();
  created.push(id);
  const token = opts.token ?? `tok-${randomUUID()}`;
  await asApplicant(id,
    `INSERT INTO funding_applications
       (id, contact_first_name, contact_last_name, contact_email, legal_name, token_hash, token_expires_at)
     VALUES ($1,'Pat','Applicant',$2,'Applicant Test LLC',$3, NOW() + interval '30 days')`,
    [id, opts.email ?? `pat-${unique()}@applicant.test`, sha(token)]);
  return { id, token };
}

async function submit(id: string) {
  await asApplicant(id,
    `UPDATE funding_applications SET status = 'submitted', submitted_at = NOW(),
            signature_name = 'Pat Applicant', signed_at = NOW(), consent_version = 'test'`);
}

describe.runIf(enabled)('funding applications (V013)', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    if (ADMIN_URL) admin = new pg.Pool({ connectionString: ADMIN_URL });
    await owner.query(
      `INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
       VALUES ($1,'Applications Test','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(
      `INSERT INTO companies (id,name,slug) VALUES ($1,'Existing Tenant Test','existing-tenant-v013')
       ON CONFLICT (id) DO NOTHING`, [EXISTING_CO]);
  });

  afterAll(async () => {
    if (created.length) {
      const r = await owner.query<{ company_id: string | null }>(
        `SELECT company_id FROM funding_applications WHERE id = ANY($1)`, [created]).catch(() => ({ rows: [] }));
      for (const row of r.rows) if (row.company_id) createdCompanies.push(row.company_id);
      await owner.query(`DELETE FROM funding_applications WHERE id = ANY($1)`, [created]).catch(() => {});
    }
    await owner?.query(`DELETE FROM companies WHERE id = ANY($1)`, [createdCompanies]).catch(() => {});
    await owner?.query(`DELETE FROM fee_schedules WHERE id = $1`, [SCHEDULE]).catch(() => {});
    await admin?.end().catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  // ─── Isolation ──────────────────────────────────────────────────────────────

  it('shows an applicant their own application and no one else’s', async () => {
    const a = await startApplication();
    const b = await startApplication();
    const seen = await asApplicant<{ id: string }>(a.id, `SELECT id FROM funding_applications`);
    expect(seen.map((r) => r.id)).toEqual([a.id]);
    expect(await asApplicant(a.id, `SELECT id FROM funding_applications WHERE id = $1`, [b.id])).toEqual([]);
  });

  it('fails closed with no application in scope, and to a tenant session', async () => {
    await startApplication();
    expect(await asApplicant(null, `SELECT id FROM funding_applications`)).toEqual([]);
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.company_id', $1, true)`, [EXISTING_CO]);
      const r = await c.query(`SELECT id FROM funding_applications`);
      expect(r.rows).toEqual([]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('resolves a token only while it is current', async () => {
    const a = await startApplication();
    const r = await app.query<{ id: string | null }>(`SELECT application_id_for_token($1) AS id`, [sha(a.token)]);
    expect(r.rows[0]!.id).toBe(a.id);
    const wrong = await app.query<{ id: string | null }>(`SELECT application_id_for_token($1) AS id`, [sha('nope')]);
    expect(wrong.rows[0]!.id).toBeNull();
    await owner.query(`UPDATE funding_applications SET token_expires_at = NOW() - interval '1 minute' WHERE id = $1`, [a.id]);
    const expired = await app.query<{ id: string | null }>(`SELECT application_id_for_token($1) AS id`, [sha(a.token)]);
    expect(expired.rows[0]!.id).toBeNull();
  });

  it('won’t let an applicant create an application already linked to a company or past draft', async () => {
    const id = randomUUID();
    created.push(id);
    await expect(asApplicant(id,
      `INSERT INTO funding_applications (id, contact_first_name, contact_last_name, contact_email, legal_name, company_id)
       VALUES ($1,'X','Y','x@y.test','Sneaky LLC',$2)`, [id, EXISTING_CO])).rejects.toThrow(/row-level security/i);
    await expect(asApplicant(id,
      `INSERT INTO funding_applications (id, contact_first_name, contact_last_name, contact_email, legal_name, status,
         signature_name, signed_at)
       VALUES ($1,'X','Y','x@y.test','Sneaky LLC','approved','X',NOW())`, [id])).rejects.toThrow(/row-level security/i);
  });

  it('keeps review fields and the company link out of the applicant’s reach', async () => {
    const a = await startApplication();
    await expect(asApplicant(a.id, `UPDATE funding_applications SET company_id = $1`, [EXISTING_CO]))
      .rejects.toThrow(/permission denied/i);
    await expect(asApplicant(a.id, `UPDATE funding_applications SET token_hash = 'x'`))
      .rejects.toThrow(/permission denied/i);
    await expect(asApplicant(a.id, `UPDATE funding_applications SET decline_reason = 'x'`))
      .rejects.toThrow(/permission denied/i);
  });

  // ─── Lifecycle guard ────────────────────────────────────────────────────────

  it('lets an applicant only submit — never approve — and locks it once submitted', async () => {
    const a = await startApplication();
    await expect(asApplicant(a.id,
      `UPDATE funding_applications SET status = 'approved', signature_name = 'P', signed_at = NOW()`))
      .rejects.toThrow(/only submit/i);
    await submit(a.id);
    await expect(asApplicant(a.id, `UPDATE funding_applications SET legal_name = 'Changed LLC'`))
      .rejects.toThrow(/locked/i);
    // …until One Source asks for more.
    await owner.query(`UPDATE funding_applications SET status = 'docs_requested' WHERE id = $1`, [a.id]);
    await asApplicant(a.id, `UPDATE funding_applications SET legal_name = 'Corrected LLC'`);
    const r = await owner.query(`SELECT legal_name FROM funding_applications WHERE id = $1`, [a.id]);
    expect(r.rows[0].legal_name).toBe('Corrected LLC');
  });

  // ─── Items ──────────────────────────────────────────────────────────────────

  it('never lets the applicant session read an encrypted number back', async () => {
    const a = await startApplication();
    await asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, value_encrypted, value_last4)
       VALUES ($1,'owner_ssn','ssn','v1:ciphertext','6789')`, [a.id]);
    const masked = await asApplicant<{ value_last4: string }>(a.id, `SELECT value_last4 FROM funding_application_items`);
    expect(masked).toEqual([{ value_last4: '6789' }]);
    await expect(asApplicant(a.id, `SELECT value_encrypted FROM funding_application_items`))
      .rejects.toThrow(/permission denied/i);
    await expect(asApplicant(a.id, `SELECT * FROM funding_application_items`))
      .rejects.toThrow(/permission denied/i);
  });

  it('stops adding or removing items after submission, and never touches One Source’s', async () => {
    const a = await startApplication();
    await asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, storage_key, original_name)
       VALUES ($1,'w9','document','k/w9.pdf','w9.pdf')`, [a.id]);
    await expect(asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, source, note)
       VALUES ($1,'corporate_resolution','document','operator','fake')`, [a.id])).rejects.toThrow(/row-level security/i);
    await submit(a.id);
    await expect(asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, storage_key, original_name)
       VALUES ($1,'w9','document','k/late.pdf','late.pdf')`, [a.id])).rejects.toThrow(/row-level security/i);
    const del = await asApplicant(a.id, `DELETE FROM funding_application_items RETURNING id`);
    expect(del).toEqual([]);
  });

  it('can’t write items into another application', async () => {
    const a = await startApplication();
    const b = await startApplication();
    await expect(asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, storage_key, original_name)
       VALUES ($1,'w9','document','k/x.pdf','x.pdf')`, [b.id])).rejects.toThrow(/row-level security/i);
  });

  it('keeps invites unreadable except through the auth functions', async () => {
    await expect(app.query(`SELECT * FROM user_invites`)).rejects.toThrow(/permission denied/i);
    await expect(app.query(`SELECT create_user_invite($1, 'h', 14)`, [randomUUID()]))
      .rejects.toThrow(/permission denied/i);
    await expect(app.query(`SELECT * FROM application_provision_client($1, $2, NULL)`, [randomUUID(), SCHEDULE]))
      .rejects.toThrow(/permission denied/i);
  });

  // ─── Approval (operator) ────────────────────────────────────────────────────

  it.runIf(ADMIN_URL)('approval creates a funding-only company, an invite-only login and an active client', async () => {
    const a = await startApplication();
    await asApplicant(a.id,
      `INSERT INTO funding_application_items (application_id, requirement_key, kind, storage_key, original_name, content_type, size_bytes)
       VALUES ($1,'articles_of_incorporation','document','k/articles.pdf','articles.pdf','application/pdf',100)`, [a.id]);
    await submit(a.id);

    const r = await admin!.query<{ company_id: string; user_id: string; created_user: boolean }>(
      `SELECT * FROM application_provision_client($1, $2, 50000)`, [a.id, SCHEDULE]);
    const p = r.rows[0]!;
    createdCompanies.push(p.company_id);
    expect(p.created_user).toBe(true);

    const co = await owner.query(`SELECT settings FROM companies WHERE id = $1`, [p.company_id]);
    expect(co.rows[0].settings.portal_mode).toBe('funding');
    const u = await owner.query(`SELECT password_hash, role FROM users WHERE id = $1`, [p.user_id]);
    expect(u.rows[0]).toEqual({ password_hash: '!invite-pending', role: 'owner' });
    const fc = await owner.query(`SELECT status, credit_limit FROM factoring_clients WHERE company_id = $1`, [p.company_id]);
    expect(fc.rows[0].status).toBe('active');
    expect(Number(fc.rows[0].credit_limit)).toBe(50000);
    const docs = await owner.query(`SELECT original_name FROM file_attachments WHERE company_id = $1 AND entity_type = 'onboarding'`, [p.company_id]);
    expect(docs.rows.map((d) => d.original_name)).toEqual(['articles.pdf']);
    const after = await owner.query(`SELECT status, token_hash FROM funding_applications WHERE id = $1`, [a.id]);
    expect(after.rows[0]).toEqual({ status: 'approved', token_hash: null });

    // Approving twice is refused.
    await expect(admin!.query(`SELECT * FROM application_provision_client($1, $2, NULL)`, [a.id, SCHEDULE]))
      .rejects.toThrow(/only a submitted application/i);

    // The invite: info and accept through the app role, once only.
    await admin!.query(`SELECT create_user_invite($1, $2, 14)`, [p.user_id, sha('invite-token')]);
    const info = await app.query(`SELECT * FROM auth_invite_info($1)`, [sha('invite-token')]);
    expect(info.rows[0].company_name).toBe('Applicant Test LLC');
    await expect(app.query(`SELECT * FROM auth_accept_invite($1, 'plaintext')`, [sha('invite-token')]))
      .rejects.toThrow(/argon2/i);
    const accepted = await app.query(`SELECT * FROM auth_accept_invite($1, '$argon2id$v=19$m=1,t=1,p=1$x$y')`, [sha('invite-token')]);
    expect(accepted.rows[0].id).toBe(p.user_id);
    const again = await app.query(`SELECT * FROM auth_accept_invite($1, '$argon2id$v=19$m=1,t=1,p=1$x$y')`, [sha('invite-token')]);
    expect(again.rows).toEqual([]);
  });

  it.runIf(ADMIN_URL)('approval links an existing login instead of creating a second one, and says so first', async () => {
    const email = `owner-${unique()}@existing.test`;
    const user = await owner.query<{ id: string }>(
      `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role)
       VALUES ($1,$2,'$argon2id$x','Ed','Existing','owner') RETURNING id`, [EXISTING_CO, email]);
    const a = await startApplication({ email: email.toUpperCase() });
    await submit(a.id);

    const warn = await admin!.query(`SELECT * FROM application_existing_login($1)`, [a.id]);
    expect(warn.rows[0]).toMatchObject({ company_id: EXISTING_CO, company_name: 'Existing Tenant Test' });

    const r = await admin!.query(`SELECT * FROM application_provision_client($1, $2, NULL)`, [a.id, SCHEDULE]);
    expect(r.rows[0]).toMatchObject({ company_id: EXISTING_CO, user_id: user.rows[0]!.id, created_user: false });
    // An existing software customer keeps their full portal.
    const co = await owner.query(`SELECT settings FROM companies WHERE id = $1`, [EXISTING_CO]);
    expect(co.rows[0].settings?.portal_mode).toBeUndefined();
  });

  it.runIf(ADMIN_URL)('keeps the existing-login lookup away from the applicant session', async () => {
    const a = await startApplication();
    await expect(asApplicant(a.id, `SELECT * FROM application_existing_login($1)`, [a.id]))
      .rejects.toThrow(/permission denied/i);
  });
});
