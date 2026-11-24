/**
 * The billing figures a job leads with (lib/job-billing.ts), against the
 * database, as the app role sees them: through row-level security.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { JOB_BILLING_JOIN, JOB_BILLING_COLUMNS } from './job-billing.js';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];

const CO = 'f3000000-0000-0000-0000-000000000001';
const OTHER = 'f3000000-0000-0000-0000-000000000002';
const USER = 'e3000000-0000-0000-0000-000000000001';
const AGENCY = 'c3000000-0000-0000-0000-000000000001';
const JOB = 'a3000000-0000-0000-0000-000000000001';
const EMPTY_JOB = 'a3000000-0000-0000-0000-000000000002';

let owner: pg.Pool;
let app: pg.Pool;

async function asCompany<T extends pg.QueryResultRow>(company: string, sql: string, params: unknown[]) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.company_id', $1, true)", [company]);
    const r = await c.query<T>(sql, params);
    await c.query('COMMIT');
    return r.rows;
  } finally {
    c.release();
  }
}
const billing = (company: string, job: string) => asCompany<Record<string, unknown>>(company,
  `SELECT ${JOB_BILLING_COLUMNS} FROM jobs j ${JOB_BILLING_JOIN} WHERE j.id = $1`, [job]);

describe.runIf(Boolean(APP_URL && OWNER_URL))('job billing figures', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    await owner.query(`DELETE FROM companies WHERE id = ANY($1)`, [[CO, OTHER]]);
    await owner.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Jobs Co', 'jobs-co-t'), ($2, 'Other Co', 'other-co-t')`, [CO, OTHER]);
    await owner.query(`INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
                       VALUES ($1, $2, 'jb@jobs.test', 'x', 'J', 'B', 'owner')`, [USER, CO]);
    await owner.query(`INSERT INTO contacts (id, company_id, name) VALUES ($1, $2, 'Army Corps')`, [AGENCY, CO]);
    await owner.query(`INSERT INTO jobs (id, company_id, name, job_number, created_by, contract_amount)
                       VALUES ($1, $3, 'Barracks', 'JOB-0001', $4, 100000), ($2, $3, 'Empty', 'JOB-0002', $4, NULL)`,
                      [JOB, EMPTY_JOB, CO, USER]);
    // Invoices on the job: sent 20k (5k paid), approved 30k, paid 10k, a 7k draft,
    // a void 99k, and a deleted 50k. Only sent/approved/paid count as billed.
    const inv = async (num: string, status: string, total: number, paid: number, deleted = false) => {
      const r = await owner.query<{ id: string }>(
        `INSERT INTO invoices (company_id, customer_id, job_id, invoice_number, due_date, status, total, paid_amount, balance_due, created_by, deleted_at)
         VALUES ($1, $2, $3, $4, CURRENT_DATE + 30, $5::invoice_status, $6::numeric, $7::numeric, $6::numeric - $7::numeric, $8,
                 CASE WHEN $9::boolean THEN NOW() END) RETURNING id`,
        [CO, AGENCY, JOB, num, status, total, paid, USER, deleted]);
      return r.rows[0]!.id;
    };
    await inv('I-1', 'sent', 20000, 5000);
    const approved = await inv('I-2', 'approved', 30000, 0);
    await inv('I-3', 'paid', 10000, 10000);
    await inv('I-4', 'draft', 7000, 0);
    await inv('I-5', 'void', 99000, 0);
    await inv('I-6', 'sent', 50000, 0, true);
    // One Source advanced 24k against the approved invoice.
    const fc = await owner.query<{ id: string }>(`INSERT INTO factoring_clients (company_id) VALUES ($1) RETURNING id`, [CO]);
    const deb = await owner.query<{ id: string }>(`INSERT INTO factoring_debtors (legal_name) VALUES ('Army Corps') RETURNING id`);
    await owner.query(
      `INSERT INTO factored_invoices (company_id, factoring_client_id, debtor_id, debtor_name, invoice_id, invoice_number,
                                      face_amount, advance_rate_pct, recourse_days, advance_amount, reserve_amount, status, advanced_on)
       VALUES ($1, $2, $3, 'Army Corps', $4, 'I-2', 30000, 80, 90, 24000, 6000, 'advanced', CURRENT_DATE)`,
      [CO, fc.rows[0]!.id, deb.rows[0]!.id, approved]);
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM factored_invoices WHERE company_id = ANY($1)`, [[CO, OTHER]]);
    await owner.query(`DELETE FROM factoring_clients WHERE company_id = ANY($1)`, [[CO, OTHER]]);
    await owner.query(`DELETE FROM companies WHERE id = ANY($1)`, [[CO, OTHER]]);
    await owner.query(`DELETE FROM factoring_debtors WHERE legal_name = 'Army Corps'`);
    await Promise.all([owner.end(), app.end()]);
  });

  it('counts billed, paid, outstanding and funded from the job’s invoices', async () => {
    const [b] = await billing(CO, JOB);
    expect(b).toEqual({
      invoice_count: 3,          // sent, approved, paid — not the draft, void or deleted one
      draft_count: 1,
      billed: '60000.00',        // 20k + 30k + 10k
      paid: '15000.00',          // 5k + 10k
      outstanding: '45000.00',   // 15k + 30k still owed; the paid one owes nothing
      funded: '24000.00',
    });
  });

  it('a job with no invoices is all zeros', async () => {
    const [b] = await billing(CO, EMPTY_JOB);
    expect(b).toEqual({ invoice_count: 0, draft_count: 0, billed: '0', paid: '0', outstanding: '0', funded: '0' });
  });

  it('another company sees nothing of this job', async () => {
    expect(await billing(OTHER, JOB)).toEqual([]);
  });
});
