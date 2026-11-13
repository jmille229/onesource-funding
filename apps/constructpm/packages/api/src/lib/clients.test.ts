/**
 * Adding clients by hand in the operator console (V014). The operator role
 * can't touch companies or users directly; these tests pin what the setup
 * functions let it do — and that they only work for funding clients, so the
 * console can't create or reset logins for software customers who aren't.
 *
 * Needs TEST_DATABASE_URL, TEST_APP_DATABASE_URL and TEST_ADMIN_DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'crypto';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const ADMIN_URL = process.env['TEST_ADMIN_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL && ADMIN_URL);

const SCHEDULE = 'f0000000-0000-0000-0000-0000000014aa';
const TENANT = 'f1400000-0000-0000-0000-000000000001'; // a software customer, not a funding client
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tag = () => randomUUID().slice(0, 8);

let owner: pg.Pool;
let app: pg.Pool;
let admin: pg.Pool;
const companies: string[] = [TENANT];

async function newClient(name = `Manual Client ${tag()}`) {
  const co = await admin.query<{ id: string }>(`SELECT admin_create_client_company($1) AS id`, [name]);
  const id = co.rows[0]!.id;
  companies.push(id);
  await admin.query(
    `INSERT INTO factoring_clients (company_id, status, default_fee_schedule_id) VALUES ($1,'active',$2)`,
    [id, SCHEDULE]);
  return id;
}

describe.runIf(enabled)('operator client setup (V014)', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await owner.query(
      `INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
       VALUES ($1,'Clients Test','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(
      `INSERT INTO companies (id,name,slug) VALUES ($1,'Software Tenant V014','software-tenant-v014')
       ON CONFLICT (id) DO NOTHING`, [TENANT]);
    await owner.query(
      `INSERT INTO users (company_id,email,password_hash,first_name,last_name,role)
       VALUES ($1,'boss@tenant-v014.test','$argon2id$x','Bo','Boss','owner') ON CONFLICT (email) DO NOTHING`, [TENANT]);
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM companies WHERE id = ANY($1)`, [companies]).catch(() => {});
    await owner?.query(`DELETE FROM fee_schedules WHERE id = $1`, [SCHEDULE]).catch(() => {});
    await admin?.end().catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('still can’t write companies or users directly', async () => {
    await expect(admin.query(`INSERT INTO companies (name, slug) VALUES ('X','x-v014')`)).rejects.toThrow(/permission denied/i);
    await expect(admin.query(`SELECT email FROM users LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });

  it('creates a company in the funding-only portal', async () => {
    const id = await newClient('  Ridgeline Test Co  ');
    const r = await owner.query(`SELECT name, settings FROM companies WHERE id = $1`, [id]);
    expect(r.rows[0].name).toBe('Ridgeline Test Co');
    expect(r.rows[0].settings.portal_mode).toBe('funding');
  });

  it('adds logins only to funding clients: first is the owner, then admins, never a duplicate email', async () => {
    const id = await newClient();
    const email = `pat-${tag()}@client-v014.test`;
    const a = await admin.query<{ id: string }>(`SELECT admin_add_client_login($1,'Pat','One',$2,'555') AS id`, [id, email.toUpperCase()]);
    const b = await admin.query<{ id: string }>(`SELECT admin_add_client_login($1,'Sam','Two',$2,NULL) AS id`, [id, `sam-${tag()}@client-v014.test`]);
    const users = await owner.query(`SELECT id, email, role, password_hash FROM users WHERE id = ANY($1) ORDER BY role DESC`,
      [[a.rows[0]!.id, b.rows[0]!.id]]);
    expect(users.rows.find((u) => u.id === a.rows[0]!.id)).toMatchObject({ email, role: 'owner', password_hash: '!invite-pending' });
    expect(users.rows.find((u) => u.id === b.rows[0]!.id)).toMatchObject({ role: 'admin' });

    await expect(admin.query(`SELECT admin_add_client_login($1,'Dup','Dup',$2,NULL)`, [id, email]))
      .rejects.toThrow(/already exists/i);
    await expect(admin.query(`SELECT admin_add_client_login($1,'X','Y','not-an-email',NULL)`, [id]))
      .rejects.toThrow(/valid email/i);
    // A software customer that isn't a funding client: refused.
    await expect(admin.query(`SELECT admin_add_client_login($1,'X','Y',$2,NULL)`, [TENANT, `x-${tag()}@t.test`]))
      .rejects.toThrow(/not a funding client/i);

    const logins = await admin.query(`SELECT * FROM admin_client_logins($1)`, [id]);
    expect(logins.rows.map((l) => l.role)).toEqual(['owner', 'admin']);
    expect(logins.rows.every((l) => l.pending)).toBe(true);
  });

  it('won’t list or re-invite logins outside a funding client', async () => {
    expect((await admin.query(`SELECT * FROM admin_client_logins($1)`, [TENANT])).rows).toEqual([]);
    const boss = await owner.query<{ id: string }>(`SELECT id FROM users WHERE email = 'boss@tenant-v014.test'`);
    await expect(admin.query(`SELECT * FROM admin_client_invite($1,$2,'h1',14)`, [TENANT, boss.rows[0]!.id]))
      .rejects.toThrow(/not a funding client/i);
    // Nor a user at another company, by naming a client company it isn't at.
    const client = await newClient();
    await expect(admin.query(`SELECT * FROM admin_client_invite($1,$2,'h2',14)`, [client, boss.rows[0]!.id]))
      .rejects.toThrow(/not at this client/i);
  });

  it('issues a set-password link that the client can use once', async () => {
    const id = await newClient();
    const email = `lee-${tag()}@client-v014.test`;
    const u = await admin.query<{ id: string }>(`SELECT admin_add_client_login($1,'Lee','Three',$2,NULL) AS id`, [id, email]);
    const inv = await admin.query(`SELECT * FROM admin_client_invite($1,$2,$3,14)`, [id, u.rows[0]!.id, sha('lee-token')]);
    expect(inv.rows[0]).toEqual({ email, first_name: 'Lee' });
    const info = await app.query(`SELECT * FROM auth_invite_info($1)`, [sha('lee-token')]);
    expect(info.rows[0]).toMatchObject({ email, first_name: 'Lee' });
    const ok = await app.query(`SELECT id FROM auth_accept_invite($1,'$argon2id$v=19$m=1,t=1,p=1$x$y')`, [sha('lee-token')]);
    expect(ok.rows[0].id).toBe(u.rows[0]!.id);
    const logins = await admin.query(`SELECT pending FROM admin_client_logins($1)`, [id]);
    expect(logins.rows[0].pending).toBe(false);
  });

  it('finds an existing login by email, whatever the case', async () => {
    const r = await admin.query(`SELECT * FROM admin_login_for_email($1)`, ['  BOSS@Tenant-v014.test ']);
    expect(r.rows[0]).toMatchObject({ company_id: TENANT, company_name: 'Software Tenant V014', user_name: 'Bo Boss' });
  });

  it('shows the operator the number and name of funded jobs only (V015)', async () => {
    const co = await newClient(`Jobs Client ${tag()}`);
    const user = await owner.query<{ id: string }>(
      `INSERT INTO users (company_id,email,password_hash,first_name,last_name,role)
       VALUES ($1,$2,'$argon2id$x','J','J','owner') RETURNING id`, [co, `j-${tag()}@client-v015.test`]);
    const jobs = await owner.query<{ id: string; job_number: string }>(
      `INSERT INTO jobs (company_id, name, job_number, status, created_by)
       VALUES ($1,'Funded Job','FJ-1','active',$2), ($1,'Unfunded Secret Job','UJ-1','active',$2)
       RETURNING id, job_number`, [co, user.rows[0]!.id]);
    const funded = jobs.rows.find((j) => j.job_number === 'FJ-1')!;
    const debtor = await owner.query<{ id: string }>(
      `INSERT INTO factoring_debtors (legal_name) VALUES ($1) RETURNING id`, [`Agency ${tag()}`]);
    const fc = await owner.query<{ id: string }>(`SELECT id FROM factoring_clients WHERE company_id = $1`, [co]);
    await owner.query(
      `INSERT INTO factored_invoices (company_id, factoring_client_id, debtor_id, debtor_name, job_id, invoice_number,
         face_amount, advance_rate_pct, recourse_days, advance_amount, reserve_amount, status, advanced_on)
       VALUES ($1,$2,$3,'Agency',$4,'INV-V015',1000,80,90,800,200,'advanced',CURRENT_DATE)`,
      [co, fc.rows[0]!.id, debtor.rows[0]!.id, funded.id]);

    const seen = await admin.query(`SELECT job_number, name FROM jobs WHERE company_id IS NOT DISTINCT FROM company_id AND id = ANY($1)`,
      [jobs.rows.map((j) => j.id)]).catch(() => null);
    // company_id isn't granted, so even naming it in a filter is refused…
    expect(seen).toBeNull();
    const visible = await admin.query(`SELECT job_number, name FROM jobs WHERE id = ANY($1)`, [jobs.rows.map((j) => j.id)]);
    expect(visible.rows).toEqual([{ job_number: 'FJ-1', name: 'Funded Job' }]);
    // …and so is every other job column.
    await expect(admin.query(`SELECT status FROM jobs WHERE id = $1`, [funded.id])).rejects.toThrow(/permission denied/i);
    await owner.query(`DELETE FROM factored_invoices WHERE company_id = $1`, [co]);
    await owner.query(`DELETE FROM factoring_debtors WHERE id = $1`, [debtor.rows[0]!.id]);
  });

  it('keeps every setup function away from the tenant/applicant role', async () => {
    for (const q of [
      `SELECT * FROM admin_login_for_email('a@b.c')`,
      `SELECT admin_create_client_company('Nope LLC')`,
      `SELECT admin_add_client_login('${TENANT}','a','b','a@b.c',NULL)`,
      `SELECT * FROM admin_client_logins('${TENANT}')`,
      `SELECT * FROM admin_client_invite('${TENANT}','${TENANT}','h',14)`,
    ]) {
      await expect(app.query(q)).rejects.toThrow(/permission denied/i);
    }
  });
});
