/**
 * Factoring is the one module where OneSource writes across every tenant, so its
 * boundaries are asserted rather than assumed:
 *
 *   - a contractor sees only their own advances;
 *   - a contractor cannot write to factoring tables at all — enforced by table
 *     privileges, not merely by the absence of a write policy;
 *   - the cross-tenant tables (debtors, fee schedules, operator accounts, audit)
 *     are unreadable by tenants;
 *   - the fee function refuses to price another tenant's invoice;
 *   - tiered fees compute correctly.
 *
 * Requires a migrated database (CI provides one); skips otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const ACME = 'f1111111-1111-1111-1111-111111111111';
const RIVAL = 'f2222222-2222-2222-2222-222222222222';
const SCHEDULE = 'f0000000-0000-0000-0000-0000000000aa';
const DEBTOR = 'd0000000-0000-0000-0000-0000000000aa';
const ACME_INV = 'a0000000-0000-0000-0000-0000000000aa';
const RIVAL_INV = 'a0000000-0000-0000-0000-0000000000bb';

let owner: pg.Pool;
let app: pg.Pool;

async function asTenant<T extends pg.QueryResultRow = pg.QueryResultRow>(
  companyId: string, sql: string, params: unknown[] = []
): Promise<T[]> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1,$2,true)', ['app.company_id', companyId]);
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

describe.runIf(enabled)('factoring', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });

    await owner.query(
      `INSERT INTO companies (id,name,slug) VALUES ($1,'Acme Factoring Test','acme-fac'),($2,'Rival Factoring Test','rival-fac')
       ON CONFLICT (id) DO NOTHING`, [ACME, RIVAL]);

    // 80% advance; 2% through day 30, 3% to day 45, 4% thereafter.
    await owner.query(
      `INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
       VALUES ($1,'Test Standard','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(`DELETE FROM fee_schedule_tiers WHERE fee_schedule_id=$1`, [SCHEDULE]);
    await owner.query(
      `INSERT INTO fee_schedule_tiers (fee_schedule_id,from_day,to_day,fee_pct)
       VALUES ($1,0,30,2.0),($1,31,45,3.0),($1,46,NULL,4.0)`, [SCHEDULE]);

    await owner.query(
      `INSERT INTO factoring_debtors (id,legal_name) VALUES ($1,'Turner Construction')
       ON CONFLICT (id) DO NOTHING`, [DEBTOR]);

    for (const [cid, co] of [[ACME, 'ca'], [RIVAL, 'cb']] as const) {
      await owner.query(
        `INSERT INTO factoring_clients (id,company_id,status,default_fee_schedule_id)
         VALUES ($1,$2,'active',$3) ON CONFLICT (company_id) DO NOTHING`,
        [`c0000000-0000-0000-0000-0000000000${co === 'ca' ? 'aa' : 'bb'}`, cid, SCHEDULE]);
    }

    const ins = `INSERT INTO factored_invoices
      (id,company_id,factoring_client_id,debtor_id,debtor_name,invoice_number,face_amount,
       fee_schedule_id,advance_rate_pct,recourse_days,advance_amount,reserve_amount,
       status,advanced_on,invoice_due_on)
      VALUES ($1,$2,$3,$4,'Turner Construction',$5,$6,$7,80,90,$8,$9,'advanced',
              CURRENT_DATE - $10::int, CURRENT_DATE + 10)
      ON CONFLICT (id) DO NOTHING`;
    await owner.query(ins, [ACME_INV, ACME, 'c0000000-0000-0000-0000-0000000000aa', DEBTOR,
      'INV-ACME-1', 100000, SCHEDULE, 80000, 20000, 35]);
    await owner.query(ins, [RIVAL_INV, RIVAL, 'c0000000-0000-0000-0000-0000000000bb', DEBTOR,
      'INV-RIVAL-9', 250000, SCHEDULE, 200000, 50000, 10]);
  });

  afterAll(async () => {
    await owner?.query('DELETE FROM companies WHERE id = ANY($1)', [[ACME, RIVAL]]).catch(() => {});
    await owner?.query('DELETE FROM fee_schedules WHERE id=$1', [SCHEDULE]).catch(() => {});
    await owner?.query('DELETE FROM factoring_debtors WHERE id=$1', [DEBTOR]).catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('shows a client only its own advances', async () => {
    const rows = await asTenant<{ invoice_number: string }>(
      ACME, 'SELECT invoice_number FROM factored_invoices ORDER BY invoice_number');
    expect(rows.map(r => r.invoice_number)).toEqual(['INV-ACME-1']);
  });

  it('hides another client’s advance even by id', async () => {
    const rows = await asTenant(ACME, 'SELECT * FROM factored_invoices WHERE id=$1', [RIVAL_INV]);
    expect(rows).toHaveLength(0);
  });

  // Table privileges, not just policy: V002's ALTER DEFAULT PRIVILEGES grants
  // full DML on every new table, so V004 must explicitly revoke it. Without the
  // revoke these would pass only because no write policy exists — a far weaker
  // guarantee that the next policy change could silently undo.
  it.each([
    ['UPDATE', `UPDATE factored_invoices SET advance_amount = 1`],
    ['DELETE', `DELETE FROM factored_invoices`],
  ])('refuses tenant %s on factored_invoices', async (_label, sql) => {
    await expect(asTenant(ACME, sql)).rejects.toThrow(/permission denied/i);
  });

  it('refuses tenant INSERT on the event ledger', async () => {
    await expect(asTenant(ACME,
      `INSERT INTO factoring_events (company_id,factored_invoice_id,event_type)
       VALUES ($1,$2,'note')`, [ACME, ACME_INV])).rejects.toThrow(/permission denied/i);
  });

  it.each(['factoring_debtors', 'fee_schedules', 'fee_schedule_tiers', 'platform_users', 'factoring_audit_log'])(
    'denies tenants any read of %s', async (table) => {
      await expect(asTenant(ACME, `SELECT count(*) FROM ${table}`)).rejects.toThrow(/permission denied/i);
    });

  it('refuses to price another client’s invoice', async () => {
    await expect(asTenant(ACME, 'SELECT factoring_accrued_fee($1)', [RIVAL_INV]))
      .rejects.toThrow(/not permitted/i);
  });

  it('prices its own invoice from the tier containing the day count', async () => {
    // 35 days outstanding falls in the 31–45 tier (3%) on a 100k face.
    const rows = await asTenant<{ fee: string }>(
      ACME, 'SELECT factoring_accrued_fee($1) AS fee', [ACME_INV]);
    expect(Number(rows[0]!.fee)).toBe(3000);
  });

  it('moves to the next tier as the invoice ages', async () => {
    // +25 days puts it at day 60, in the open-ended 46+ tier (4%).
    const rows = await asTenant<{ fee: string }>(
      ACME, `SELECT factoring_accrued_fee($1, CURRENT_DATE + 25) AS fee`, [ACME_INV]);
    expect(Number(rows[0]!.fee)).toBe(4000);
  });

  it('stops accruing once the debtor has paid', async () => {
    await owner.query(
      `UPDATE factored_invoices SET status='collected', collected_on = CURRENT_DATE - 20 WHERE id=$1`,
      [ACME_INV]);
    // Day 15 at collection → 2% tier, and asking far in the future must not move it.
    const rows = await asTenant<{ fee: string }>(
      ACME, `SELECT factoring_accrued_fee($1, CURRENT_DATE + 365) AS fee`, [ACME_INV]);
    expect(Number(rows[0]!.fee)).toBe(2000);
    await owner.query(
      `UPDATE factored_invoices SET status='advanced', collected_on=NULL WHERE id=$1`, [ACME_INV]);
  });

  it('rejects an advance/reserve split that does not equal the face amount', async () => {
    await expect(owner.query(
      `INSERT INTO factored_invoices
       (company_id,factoring_client_id,debtor_id,debtor_name,invoice_number,face_amount,
        advance_rate_pct,recourse_days,advance_amount,reserve_amount,status,advanced_on)
       VALUES ($1,$2,$3,'X','BAD-1',100000,80,90,80000,50000,'advanced',CURRENT_DATE)`,
      [ACME, 'c0000000-0000-0000-0000-0000000000aa', DEBTOR]))
      .rejects.toThrow(/factored_split_ck/i);
  });
});

/**
 * Funding requests are the first factoring rows a tenant may write. These assert
 * the narrowness of that write surface — a client can ask, and withdraw, and
 * nothing else.
 */
describe.runIf(enabled)('funding requests', () => {
  const REQ_CO = 'f3333333-3333-3333-3333-333333333333';
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let invoiceId: string;
  let requestId: string;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: OWNER_URL });
    tenantPool = new pg.Pool({ connectionString: APP_URL });
    await ownerPool.query(
      `INSERT INTO companies (id,name,slug) VALUES ($1,'Request Co','request-co')
       ON CONFLICT (id) DO NOTHING`, [REQ_CO]);
    const u = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (company_id,email,password_hash,first_name,last_name,role)
       VALUES ($1,'req@test.com','x','R','C','owner') RETURNING id`, [REQ_CO]);
    const j = await ownerPool.query<{ id: string }>(
      `INSERT INTO jobs (company_id,job_number,name,status,created_by)
       VALUES ($1,'R-1','Req Job','active',$2) RETURNING id`, [REQ_CO, u.rows[0]!.id]);
    const ct = await ownerPool.query<{ id: string }>(
      `INSERT INTO contacts (company_id,name,type) VALUES ($1,'Debtor Co','customer') RETURNING id`,
      [REQ_CO]);
    const inv = await ownerPool.query<{ id: string }>(
      `INSERT INTO invoices (company_id,job_id,customer_id,invoice_number,due_date,total,created_by)
       VALUES ($1,$2,$3,'REQ-INV-1',CURRENT_DATE+30,50000,$4) RETURNING id`,
      [REQ_CO, j.rows[0]!.id, ct.rows[0]!.id, u.rows[0]!.id]);
    invoiceId = inv.rows[0]!.id;
    const r = await ownerPool.query<{ id: string }>(
      `INSERT INTO funding_requests (company_id,invoice_id,requested_amount,invoice_number,requested_by)
       VALUES ($1,$2,50000,'REQ-INV-1',$3) RETURNING id`, [REQ_CO, invoiceId, u.rows[0]!.id]);
    requestId = r.rows[0]!.id;
  });

  afterAll(async () => {
    await ownerPool?.query('DELETE FROM companies WHERE id=$1', [REQ_CO]).catch(() => {});
    await ownerPool?.end().catch(() => {});
    await tenantPool?.end().catch(() => {});
  });

  async function asReqTenant(sql: string, params: unknown[] = []) {
    const c = await tenantPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1,$2,true)', ['app.company_id', REQ_CO]);
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  it('lets a client read its own requests', async () => {
    const r = await asReqTenant('SELECT invoice_number FROM funding_requests');
    expect(r.rows).toHaveLength(1);
  });

  it('lets a client withdraw a pending request', async () => {
    const r = await asReqTenant(
      `UPDATE funding_requests SET status='withdrawn' WHERE id=$1 RETURNING status`, [requestId]);
    expect(r.rows[0]!['status']).toBe('withdrawn');
    await ownerPool.query(`UPDATE funding_requests SET status='submitted' WHERE id=$1`, [requestId]);
  });

  // The whole point of a request being distinct from an advance.
  it('refuses to let a client approve its own request', async () => {
    await expect(asReqTenant(
      `UPDATE funding_requests SET status='approved' WHERE id=$1`, [requestId]))
      .rejects.toThrow(/row-level security/i);
  });

  it('refuses to let a client change the requested amount', async () => {
    // Column-level grant: only `status` is updatable, so this fails on privilege.
    await expect(asReqTenant(
      `UPDATE funding_requests SET requested_amount=999999 WHERE id=$1`, [requestId]))
      .rejects.toThrow(/permission denied/i);
  });

  it('refuses to let a client delete a request', async () => {
    await expect(asReqTenant(`DELETE FROM funding_requests WHERE id=$1`, [requestId]))
      .rejects.toThrow(/permission denied/i);
  });

  it('still refuses any write to the funded book', async () => {
    await expect(asReqTenant(
      `INSERT INTO factored_invoices (company_id,factoring_client_id,debtor_id,debtor_name,
        invoice_number,face_amount,advance_rate_pct,recourse_days,advance_amount,reserve_amount,
        status,advanced_on) VALUES ($1,$1,$1,'x','y',1,80,90,1,0,'advanced',CURRENT_DATE)`, [REQ_CO]))
      .rejects.toThrow(/permission denied/i);
  });

  it('limits the operator to funding-request documents, not the whole file store', async () => {
    const u = await ownerPool.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id=$1 LIMIT 1`, [REQ_CO]);
    await ownerPool.query(
      `INSERT INTO file_attachments (company_id,entity_type,entity_id,original_name,storage_key,
         content_type,size_bytes,uploaded_by)
       VALUES ($1,'funding_request',$2,'invoice-copy.pdf','k1','application/pdf',10,$3),
              ($1,'job',$2,'site-photo.jpg','k2','image/jpeg',10,$3)`,
      [REQ_CO, requestId, u.rows[0]!.id]);

    // Read as the operator role via its own connection.
    const admin = new pg.Pool({
      connectionString: (OWNER_URL as string).replace(
        /\/\/[^@]*@/, '//constructpm_factoring_admin:adminpw@'),
    });
    try {
      const r = await admin.query<{ original_name: string }>(
        `SELECT original_name FROM file_attachments WHERE company_id=$1`, [REQ_CO]);
      expect(r.rows.map((x) => x.original_name)).toEqual(['invoice-copy.pdf']);
    } finally {
      await admin.end().catch(() => {});
    }
  });
});
