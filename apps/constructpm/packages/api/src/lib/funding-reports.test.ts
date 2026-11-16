/**
 * Statements and insights for a factoring client, against a small known book:
 *
 *   A  $10,000  advanced Jan 10, paid in full Feb 9, reserve released Feb 12
 *   B   $5,000  advanced Feb 1, short-paid $4,800 Mar 1, released Mar 5
 *   C  $20,000  advanced Feb 20, still open
 *   plus a $15,000 invoice billed in March and not funded.
 *
 * Flat 2% fee, 80% advance.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { fundingInsights, fundingStatement, type Queryable } from './funding-reports.js';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const CO = 'f1800000-0000-0000-0000-000000000001';
const OTHER = 'f1800000-0000-0000-0000-000000000002';
const USER = 'e1800000-0000-0000-0000-000000000001';
const SCHEDULE = 'f0000000-0000-0000-0000-0000000018aa';
const FC = 'c1800000-0000-0000-0000-000000000001';
const DEBTOR = 'd1800000-0000-0000-0000-000000000001';
const A = 'a1800000-0000-0000-0000-00000000000a';
const B = 'a1800000-0000-0000-0000-00000000000b';
const C = 'a1800000-0000-0000-0000-00000000000c';

let owner: pg.Pool;
let app: pg.Pool;

/** Runs as the tenant, the way the API does. */
async function asTenant<T>(company: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.company_id', $1, true)`, [company]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } finally { c.release(); }
}

async function advance(id: string, number: string, face: number, on: string,
  status: string, collected: string | null, closed: string | null) {
  await owner.query(
    `INSERT INTO factored_invoices (id, company_id, factoring_client_id, debtor_id, debtor_name, invoice_number,
       face_amount, fee_schedule_id, advance_rate_pct, recourse_days, advance_amount, reserve_amount, status,
       advanced_on, collected_on, closed_on)
     VALUES ($1,$2,$3,$4,'Navy NAVFAC (V018)',$5,$6,$7,80,90,$8,$9,$10,$11,$12,$13)`,
    [id, CO, FC, DEBTOR, number, face, SCHEDULE, face * 0.8, face * 0.2, status, on, collected, closed]);
  await event(id, 'advance', face * 0.8, on);
}
const event = (id: string, type: string, amount: number, on: string) => owner.query(
  `INSERT INTO factoring_events (company_id, factored_invoice_id, event_type, amount, occurred_on, memo)
   VALUES ($1,$2,$3,$4,$5,$6)`, [CO, id, type, amount, on, type === 'payment_received' ? 'Check #7' : null]);

describe.runIf(enabled)('funding statements and insights', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    await owner.query(`INSERT INTO companies (id,name,slug) VALUES ($1,'Reports Test','reports-v018'),($2,'Other V018','other-v018')
                       ON CONFLICT (id) DO NOTHING`, [CO, OTHER]);
    await owner.query(`INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
                       VALUES ($1,$2,'owner@reports-v018.test','x','Rae','Ports','owner') ON CONFLICT (id) DO NOTHING`, [USER, CO]);
    await owner.query(`INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
                       VALUES ($1,'Flat 2% V018','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(`DELETE FROM fee_schedule_tiers WHERE fee_schedule_id = $1`, [SCHEDULE]);
    await owner.query(`INSERT INTO fee_schedule_tiers (fee_schedule_id,from_day,to_day,fee_pct) VALUES ($1,0,NULL,2.0)`, [SCHEDULE]);
    await owner.query(`INSERT INTO factoring_debtors (id, legal_name) VALUES ($1,'Navy NAVFAC (V018)') ON CONFLICT (id) DO NOTHING`, [DEBTOR]);
    await owner.query(`INSERT INTO factoring_clients (id, company_id, status, default_fee_schedule_id)
                       VALUES ($1,$2,'active',$3) ON CONFLICT (company_id) DO NOTHING`, [FC, CO, SCHEDULE]);

    await advance(A, 'NAV-1', 10000, '2026-01-10', 'closed', '2026-02-09', '2026-02-12');
    await event(A, 'payment_received', 10000, '2026-02-09');
    await event(A, 'reserve_release', 1800, '2026-02-12');
    await advance(B, 'NAV-2', 5000, '2026-02-01', 'closed', '2026-03-01', '2026-03-05');
    await event(B, 'payment_received', 4800, '2026-03-01');
    await event(B, 'reserve_release', 700, '2026-03-05');
    await advance(C, 'NAV-3', 20000, '2026-02-20', 'advanced', null, null);
    const agency = await owner.query(`SELECT id FROM contacts WHERE company_id = $1 LIMIT 1`, [CO]);
    await owner.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, status, issue_date, due_date, subtotal, total, balance_due, created_by)
       VALUES ($1,$2,'NAV-4','sent','2026-03-10','2026-04-09',15000,15000,15000,$3)`, [CO, agency.rows[0].id, USER]);
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM companies WHERE id = ANY($1)`, [[CO, OTHER]]).catch(() => {});
    await owner?.query(`DELETE FROM factoring_debtors WHERE id = $1`, [DEBTOR]).catch(() => {});
    await owner?.query(`DELETE FROM fee_schedules WHERE id = $1`, [SCHEDULE]).catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('a February statement: the activity in date order, with totals', async () => {
    const s = await asTenant(CO, (db) => fundingStatement(db, '2026-02-01', '2026-02-28'));
    expect(s.lines.map((l) => [l.date, l.type, l.invoice_number, l.amount])).toEqual([
      ['2026-02-01', 'advance', 'NAV-2', 4000],
      ['2026-02-09', 'payment_received', 'NAV-1', 10000],
      ['2026-02-12', 'reserve_release', 'NAV-1', 1800],
      ['2026-02-20', 'advance', 'NAV-3', 16000],
    ]);
    expect(s.lines.every((l) => l.invoice_id)).toBe(true);
    expect(s.totals).toEqual({
      advanced: 20000, agency_paid: 10000, reserve_released: 1800, charged_back: 0,
      fees_on_settled: 200, short_paid_on_settled: 0, settled_count: 1,
    });
  });

  it('what was open at the end of the period, as it stood then', async () => {
    const feb = await asTenant(CO, (db) => fundingStatement(db, '2026-02-01', '2026-02-28'));
    expect(feb.open_at_end).toEqual({ count: 2, advanced: 20000, reserve: 5000, fees_accrued: 500 });
    const mar = await asTenant(CO, (db) => fundingStatement(db, '2026-03-01', '2026-03-31'));
    expect(mar.open_at_end).toMatchObject({ count: 1, advanced: 16000 });
    expect(mar.totals).toMatchObject({ settled_count: 1, fees_on_settled: 100, short_paid_on_settled: 200 });
  });

  it('insights: monthly volume and fees, share funded, cost, and how the agency pays', async () => {
    const i = await asTenant(CO, (db) => fundingInsights(db, '2026-03-31'));
    expect(i.months).toHaveLength(12);
    expect(i.months[0]!.month).toBe('2025-04');
    expect(i.months.slice(-3)).toEqual([
      { month: '2026-01', billed: 10000, funded: 10000, advanced: 8000, fees: 200 },
      { month: '2026-02', billed: 25000, funded: 25000, advanced: 20000, fees: 500 },
      { month: '2026-03', billed: 15000, funded: 0, advanced: 0, fees: 0 },
    ]);
    expect(i.share_funded_12m).toBeCloseTo(0.7);
    // A took 30 days to pay, B 28 (February 2026).
    expect(i.lifetime).toMatchObject({ funded_count: 3, funded: 35000, fees: 700, avg_days_to_pay: 29, since: '2026-01-10' });
    expect(i.lifetime.effective_fee_rate).toBeCloseTo(0.02);
    expect(i.agencies).toEqual([{
      agency: 'Navy NAVFAC (V018)', funded_count: 3, funded: 35000, open_count: 1,
      avg_days_to_pay: 29, slowest_days: 30, short_paid: 200,
    }]);
  });

  it('another company sees none of it', async () => {
    const s = await asTenant(OTHER, (db) => fundingStatement(db, '2026-01-01', '2026-12-31'));
    expect(s.lines).toEqual([]);
    expect(s.open_at_end.count).toBe(0);
    const i = await asTenant(OTHER, (db) => fundingInsights(db, '2026-03-31'));
    expect(i.lifetime.funded_count).toBe(0);
    expect(i.agencies).toEqual([]);
    expect(i.share_funded_12m).toBeNull();
  });
});
