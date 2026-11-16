/**
 * V017: every advance has an invoice in the client's book, the invoice follows
 * the ledger, and a funded invoice is locked for the client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const CO = 'f1700000-0000-0000-0000-000000000001';
const OTHER = 'f1700000-0000-0000-0000-000000000002';
const USER = 'e1700000-0000-0000-0000-000000000001';
const SCHEDULE = 'f0000000-0000-0000-0000-0000000017aa';
const FC = 'c1700000-0000-0000-0000-000000000001';
const DEBTOR = 'd1700000-0000-0000-0000-000000000001';
const AGENCY = 'GSA Region 3 (V017)';

let owner: pg.Pool;
let app: pg.Pool;

/** An advance, as the operator console or the Advance Book import writes it. */
async function advance(id: string, invoiceNumber: string, face: number, company = CO, fc = FC) {
  const adv = Math.round(face * 80) / 100;
  await owner.query(
    `INSERT INTO factored_invoices (id, company_id, factoring_client_id, debtor_id, debtor_name, invoice_number,
       face_amount, fee_schedule_id, advance_rate_pct, recourse_days, advance_amount, reserve_amount, status, advanced_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,80,90,$9,$10,'advanced','2026-03-02')`,
    [id, company, fc, DEBTOR, AGENCY, invoiceNumber, face, SCHEDULE, adv, face - adv]);
}

async function invoiceFor(advanceId: string) {
  const r = await owner.query(
    `SELECT i.id, i.invoice_number, i.status::text, i.total::float, i.paid_amount::float, i.balance_due::float,
            i.source, i.created_by, i.job_id, i.issue_date::text, c.name AS agency
       FROM factored_invoices fi JOIN invoices i ON i.id = fi.invoice_id JOIN contacts c ON c.id = i.customer_id
      WHERE fi.id = $1`, [advanceId]);
  return r.rows[0];
}

async function pay(advanceId: string, amount: number, on = '2026-04-20') {
  const r = await owner.query(
    `INSERT INTO factoring_events (company_id, factored_invoice_id, event_type, amount, occurred_on, memo)
     VALUES ($1,$2,'payment_received',$3,$4,'Check #1') RETURNING id`, [CO, advanceId, amount, on]);
  return r.rows[0].id as string;
}

/** Runs as the client (tenant role, company set), the way the API does. */
async function asClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.company_id', $1, true)`, [CO]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

describe.runIf(enabled)('advances and invoices are one record (V017)', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    await owner.query(`INSERT INTO companies (id,name,slug) VALUES ($1,'Sync Test','sync-v017'),($2,'Other V017','other-v017')
                       ON CONFLICT (id) DO NOTHING`, [CO, OTHER]);
    await owner.query(`INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
                       VALUES ($1,$2,'owner@sync-v017.test','x','Sam','Sync','owner') ON CONFLICT (id) DO NOTHING`, [USER, CO]);
    await owner.query(`INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
                       VALUES ($1,'Flat V017','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(`INSERT INTO factoring_debtors (id, legal_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [DEBTOR, AGENCY]);
    await owner.query(`INSERT INTO factoring_clients (id, company_id, status, default_fee_schedule_id)
                       VALUES ($1,$2,'active',$3) ON CONFLICT (company_id) DO NOTHING`, [FC, CO, SCHEDULE]);
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM companies WHERE id = ANY($1)`, [[CO, OTHER]]).catch(() => {});
    await owner?.query(`DELETE FROM factoring_debtors WHERE id = $1`, [DEBTOR]).catch(() => {});
    await owner?.query(`DELETE FROM fee_schedules WHERE id = $1`, [SCHEDULE]).catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('an advance with no invoice gets one, from One Source, under the agency', async () => {
    await advance('a1700000-0000-0000-0000-000000000001', 'HIST-0001', 25000);
    expect(await invoiceFor('a1700000-0000-0000-0000-000000000001')).toMatchObject({
      invoice_number: 'HIST-0001', status: 'approved', total: 25000, balance_due: 25000,
      source: 'one_source', created_by: null, job_id: null, issue_date: '2026-03-02', agency: AGENCY,
    });
    // A second advance to the same agency reuses the contact.
    await advance('a1700000-0000-0000-0000-000000000002', 'HIST-0002', 9000);
    const contacts = await owner.query(`SELECT count(*)::int AS n FROM contacts WHERE company_id = $1 AND name = $2`, [CO, AGENCY]);
    expect(contacts.rows[0].n).toBe(1);
  });

  it('One Source’s collections become payments, and corrections never double them', async () => {
    const id = 'a1700000-0000-0000-0000-000000000001';
    const ev = await pay(id, 24400);
    expect(await invoiceFor(id)).toMatchObject({ status: 'partially_paid', paid_amount: 24400, balance_due: 600 });
    // The import corrects the amount received: rebuilt, not added.
    await owner.query(`UPDATE factoring_events SET amount = 25000 WHERE id = $1`, [ev]);
    expect(await invoiceFor(id)).toMatchObject({ status: 'paid', paid_amount: 25000, balance_due: 0 });
    const rows = await owner.query(`SELECT count(*)::int AS n FROM invoice_payments ip JOIN factored_invoices fi
                                     ON fi.invoice_id = ip.invoice_id WHERE fi.id = $1`, [id]);
    expect(rows.rows[0].n).toBe(1);
    // Removed from the ledger: back to approved and unpaid.
    await owner.query(`DELETE FROM factoring_events WHERE id = $1`, [ev]);
    expect(await invoiceFor(id)).toMatchObject({ status: 'approved', paid_amount: 0, balance_due: 25000 });
  });

  it('a corrected amount or invoice number carries over to an invoice One Source created', async () => {
    const id = 'a1700000-0000-0000-0000-000000000002';
    await owner.query(`UPDATE factored_invoices SET face_amount = 9200, advance_amount = 7360, reserve_amount = 1840,
                         invoice_number = 'HIST-0002A' WHERE id = $1`, [id]);
    expect(await invoiceFor(id)).toMatchObject({ invoice_number: 'HIST-0002A', total: 9200, balance_due: 9200 });
  });

  it('links to the invoice the client already logged instead of adding a duplicate', async () => {
    const contact = await owner.query(`INSERT INTO contacts (company_id, name) VALUES ($1,'Their Own Agency Name') RETURNING id`, [CO]);
    const logged = await owner.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, status, issue_date, due_date, subtotal, total, balance_due, created_by)
       VALUES ($1,$2,'inv-0042','approved','2026-02-20','2026-03-22',12000,12000,12000,$3) RETURNING id`,
      [CO, contact.rows[0].id, USER]);
    await advance('a1700000-0000-0000-0000-000000000003', 'INV 42', 12000);
    const inv = await invoiceFor('a1700000-0000-0000-0000-000000000003');
    expect(inv).toMatchObject({ id: logged.rows[0].id, source: 'client', invoice_number: 'inv-0042', agency: 'Their Own Agency Name' });
    // The client's own invoice keeps its own figures.
    await owner.query(`UPDATE factored_invoices SET face_amount = 11900, advance_amount = 9520, reserve_amount = 2380
                        WHERE id = 'a1700000-0000-0000-0000-000000000003'`);
    expect((await invoiceFor('a1700000-0000-0000-0000-000000000003')).total).toBe(12000);
  });

  it('only matches within the same company, and only on the same amount', async () => {
    const otherFc = 'c1700000-0000-0000-0000-000000000002';
    await owner.query(`INSERT INTO factoring_clients (id, company_id, status, default_fee_schedule_id)
                       VALUES ($1,$2,'active',$3) ON CONFLICT (company_id) DO NOTHING`, [otherFc, OTHER, SCHEDULE]);
    await advance('a1700000-0000-0000-0000-000000000004', 'INV-0042', 12000, OTHER, otherFc);
    expect(await invoiceFor('a1700000-0000-0000-0000-000000000004')).toMatchObject({ source: 'one_source' });
    // Same number, different amount: not the same invoice.
    await advance('a1700000-0000-0000-0000-000000000005', 'INV-42', 30000);
    expect(await invoiceFor('a1700000-0000-0000-0000-000000000005')).toMatchObject({ source: 'one_source', total: 30000 });
  });

  it('a funded invoice is locked for the client: amount, number, agency, void, delete', async () => {
    const inv = (await invoiceFor('a1700000-0000-0000-0000-000000000003')).id as string;
    for (const sql of [
      `UPDATE invoices SET total = 1 WHERE id = $1`,
      `UPDATE invoices SET invoice_number = 'X' WHERE id = $1`,
      `UPDATE invoices SET status = 'void' WHERE id = $1`,
      `UPDATE invoices SET deleted_at = NOW() WHERE id = $1`,
      `DELETE FROM invoices WHERE id = $1`,
    ]) {
      await expect(asClient((c) => c.query(sql, [inv]))).rejects.toMatchObject({ hint: 'funded_invoice_locked' });
    }
  });

  it('…but notes, the job or contract, and payments on it still work', async () => {
    const inv = (await invoiceFor('a1700000-0000-0000-0000-000000000003')).id as string;
    const r = await asClient((c) => c.query(
      `UPDATE invoices SET notes = 'Called the CO', contract_reference = 'GS-07F-123',
              paid_amount = 100, balance_due = total - 100, status = 'partially_paid'
        WHERE id = $1 RETURNING notes`, [inv]));
    expect(r.rows[0].notes).toBe('Called the CO');
  });

  it('an invoice nobody funded is the client’s to change, and needs no job', async () => {
    const contact = await owner.query(`SELECT id FROM contacts WHERE company_id = $1 LIMIT 1`, [CO]);
    const r = await asClient(async (c) => {
      const ins = await c.query(
        `INSERT INTO invoices (company_id, customer_id, invoice_number, status, due_date, subtotal, total, balance_due,
                               created_by, contract_reference)
         VALUES ($1,$2,'NEW-1','sent','2026-12-01',500,500,500,$3,'W912-26-C-0001') RETURNING id`,
        [CO, contact.rows[0].id, USER]);
      await c.query(`UPDATE invoices SET total = 550, status = 'void' WHERE id = $1`, [ins.rows[0].id]);
      return c.query(`SELECT total::float, status::text, job_id FROM invoices WHERE id = $1`, [ins.rows[0].id]);
    });
    expect(r.rows[0]).toEqual({ total: 550, status: 'void', job_id: null });
  });

  it('the client can’t create an invoice “from One Source” without a user', async () => {
    const contact = await owner.query(`SELECT id FROM contacts WHERE company_id = $1 LIMIT 1`, [CO]);
    await expect(asClient((c) => c.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, due_date, total)
       VALUES ($1,$2,'NOUSER','2026-12-01',1)`, [CO, contact.rows[0].id]))).rejects.toThrow(/invoices_created_by_ck/);
  });
});
