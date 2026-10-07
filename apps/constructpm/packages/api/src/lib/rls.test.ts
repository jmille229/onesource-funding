/**
 * Tenant isolation is the single security property this product cannot get wrong,
 * and it is enforced in the database rather than in application code. These tests
 * connect as `constructpm_app` — the same non-owner, RLS-subject role the API uses
 * in production — and assert the boundary holds.
 *
 * Requires a migrated database. CI provides it; locally:
 *   npm run migrate -w packages/db
 *
 * Skips itself (rather than failing) when TEST_DATABASE_URL is absent, so the
 * unit suite still runs on a machine with no Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const ACME = '11111111-1111-1111-1111-111111111111';
const RIVAL = '22222222-2222-2222-2222-222222222222';
const ACME_USER = 'dddddddd-1111-1111-1111-111111111111';
const RIVAL_USER = 'eeeeeeee-2222-2222-2222-222222222222';

let owner: pg.Pool;
let app: pg.Pool;

/** Runs a query as the app role with a tenant scope, exactly as createRlsClient does. */
async function asTenant<T extends pg.QueryResultRow = pg.QueryResultRow>(
  companyId: string,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.company_id', companyId]);
    const r = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return r.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

describe.runIf(enabled)('row-level security', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });

    // Seeded as the owner role, which bypasses RLS.
    await owner.query(
      `INSERT INTO companies (id, name, slug) VALUES ($1,'Acme Builders','acme-test'), ($2,'Rival Construction','rival-test')
       ON CONFLICT (id) DO NOTHING`,
      [ACME, RIVAL]
    );
    await owner.query(
      `INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
       VALUES ($1,$3,'a@acme.test','x','A','A','owner'), ($2,$4,'r@rival.test','x','R','R','owner')
       ON CONFLICT (id) DO NOTHING`,
      [ACME_USER, RIVAL_USER, ACME, RIVAL]
    );
    await owner.query(
      `INSERT INTO jobs (company_id, job_number, name, status, created_by)
       VALUES ($1,'A-1','Acme Job','active',$3), ($2,'R-1','Rival Secret Job','active',$4)
       ON CONFLICT DO NOTHING`,
      [ACME, RIVAL, ACME_USER, RIVAL_USER]
    );
  });

  afterAll(async () => {
    await owner?.query('DELETE FROM companies WHERE id = ANY($1)', [[ACME, RIVAL]]).catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('shows a tenant only its own rows', async () => {
    const rows = await asTenant<{ name: string }>(ACME, 'SELECT name FROM jobs ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual(['Acme Job']);
  });

  it('hides another tenant even when the row id is known (IDOR)', async () => {
    const rows = await asTenant(ACME, `SELECT name FROM jobs WHERE job_number = 'R-1'`);
    expect(rows).toHaveLength(0);
  });

  it('scopes users to the tenant', async () => {
    const rows = await asTenant<{ email: string }>(ACME, 'SELECT email FROM users ORDER BY email');
    expect(rows.map((r) => r.email)).toEqual(['a@acme.test']);
  });

  it('fails closed when no tenant is set', async () => {
    // No set_config — current_company_id() is NULL, so every USING clause is false.
    const r = await app.query('SELECT * FROM jobs');
    expect(r.rows).toHaveLength(0);
  });

  it('rejects writing a row into another tenant', async () => {
    await expect(
      asTenant(
        ACME,
        `INSERT INTO jobs (company_id, job_number, name, status, created_by) VALUES ($1,'X-1','planted','active',$2)`,
        [RIVAL, RIVAL_USER]
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects moving one of its own rows to another tenant', async () => {
    await expect(
      asTenant(ACME, `UPDATE jobs SET company_id = $1 WHERE job_number = 'A-1'`, [RIVAL])
    ).rejects.toThrow(/row-level security/i);
  });

  describe('invoice payments (V011)', () => {
    let rivalInvoice = '';
    beforeAll(async () => {
      const job = await owner.query<{ id: string }>(`SELECT id FROM jobs WHERE job_number = 'R-1' AND company_id = $1`, [RIVAL]);
      const contact = await owner.query<{ id: string }>(
        `INSERT INTO contacts (company_id, name, type) VALUES ($1, 'Rival Agency', 'customer') RETURNING id`, [RIVAL]);
      const inv = await owner.query<{ id: string }>(
        `INSERT INTO invoices (company_id, job_id, customer_id, invoice_number, due_date, total, balance_due, created_by)
         VALUES ($1,$2,$3,'R-INV-1',CURRENT_DATE,1000,1000,$4) RETURNING id`,
        [RIVAL, job.rows[0]!.id, contact.rows[0]!.id, RIVAL_USER]);
      rivalInvoice = inv.rows[0]!.id;
      await owner.query(
        `INSERT INTO invoice_payments (company_id, invoice_id, amount, paid_on, recorded_by)
         VALUES ($1,$2,250,CURRENT_DATE,$3)`, [RIVAL, rivalInvoice, RIVAL_USER]);
    });

    it('hides another tenant’s payments', async () => {
      const rows = await asTenant(ACME, 'SELECT * FROM invoice_payments WHERE invoice_id = $1', [rivalInvoice]);
      expect(rows).toHaveLength(0);
    });

    it('cannot record a payment against another tenant', async () => {
      await expect(asTenant(ACME,
        `INSERT INTO invoice_payments (company_id, invoice_id, amount, paid_on, recorded_by)
         VALUES ($1,$2,1,CURRENT_DATE,$3)`, [RIVAL, rivalInvoice, ACME_USER])).rejects.toThrow(/row-level security/i);
    });

    it('treats recorded payments as a record: no edits or deletes', async () => {
      await expect(asTenant(RIVAL, `UPDATE invoice_payments SET amount = 1 WHERE invoice_id = $1`, [rivalInvoice]))
        .rejects.toThrow(/permission denied/i);
      await expect(asTenant(RIVAL, `DELETE FROM invoice_payments WHERE invoice_id = $1`, [rivalInvoice]))
        .rejects.toThrow(/permission denied/i);
    });
  });

  describe('agency approval rule (V011)', () => {
    it('lets a tenant read the rule but not the agency table', async () => {
      await owner.query(`DELETE FROM factoring_debtors WHERE legal_name = 'RLS Test Agency'`);
      await owner.query(
        `INSERT INTO factoring_debtors (legal_name, dba, credit_limit, risk_grade, approval_evidence, approval_instructions)
         VALUES ('RLS Test Agency', 'RTA', 999999, 'C', ARRAY['portal_screenshot'], 'Upload the portal screen')`);
      try {
        const viaDba = await asTenant<{ accepted: string[]; instructions: string }>(
          ACME, `SELECT * FROM agency_approval_requirement($1)`, ['  rta ']);
        expect(viaDba[0]).toEqual({ accepted: ['portal_screenshot'], instructions: 'Upload the portal screen' });
        const unknown = await asTenant<{ accepted: string[]; instructions: string | null }>(
          ACME, `SELECT * FROM agency_approval_requirement($1)`, ['Nobody We Know']);
        expect(unknown[0]).toEqual({ accepted: ['approved_invoice'], instructions: null });
        await expect(asTenant(ACME, 'SELECT credit_limit FROM factoring_debtors')).rejects.toThrow(/permission denied/i);
      } finally {
        await owner.query(`DELETE FROM factoring_debtors WHERE legal_name = 'RLS Test Agency'`);
      }
    });
  });

  it('cannot delete another tenant’s rows', async () => {
    await asTenant(ACME, `DELETE FROM jobs WHERE job_number = 'R-1'`);
    const survived = await owner.query(`SELECT 1 FROM jobs WHERE job_number = 'R-1'`);
    expect(survived.rowCount).toBe(1);
  });
});
