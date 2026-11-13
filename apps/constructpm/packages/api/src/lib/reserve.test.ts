/**
 * V016: a short payment comes out of the reserve. One definition serves the
 * operator's release, the Advances table and the client's "net expected", so
 * these tests pin the arithmetic and who can see it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const CO = 'f1600000-0000-0000-0000-000000000001';
const OTHER = 'f1600000-0000-0000-0000-000000000002';
const SCHEDULE = 'f0000000-0000-0000-0000-0000000016aa';
const FC = 'c1600000-0000-0000-0000-000000000001';
const DEBTOR = 'd1600000-0000-0000-0000-000000000001';

let owner: pg.Pool;
let app: pg.Pool;

/** An advance on a $10,000 invoice: $8,000 advanced, $2,000 reserve, 2% flat fee. */
async function advance(id: string, opts: { received?: number | null; collected?: boolean } = {}) {
  await owner.query(
    `INSERT INTO factored_invoices (id, company_id, factoring_client_id, debtor_id, debtor_name, invoice_number,
       face_amount, fee_schedule_id, advance_rate_pct, recourse_days, advance_amount, reserve_amount, status,
       advanced_on, collected_on)
     VALUES ($1,$2,$3,$4,'Agency',$8,10000,$5,80,90,8000,2000,$6, CURRENT_DATE - 20, $7)`,
    [id, CO, FC, DEBTOR, SCHEDULE, opts.collected ? 'collected' : 'advanced',
     opts.collected ? new Date().toISOString().slice(0, 10) : null, `V016-${id.slice(-2)}`]);
  if (opts.collected && opts.received !== null) {
    await owner.query(
      `INSERT INTO factoring_events (company_id, factored_invoice_id, event_type, amount, occurred_on)
       VALUES ($1,$2,'payment_received',$3,CURRENT_DATE)`, [CO, id, opts.received ?? 10000]);
  }
}

async function figures(pool: pg.Pool, id: string, company?: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (company) await c.query(`SELECT set_config('app.company_id', $1, true)`, [company]);
    const r = await c.query(
      `SELECT factoring_shortfall($1)::float AS shortfall, factoring_net_reserve($1)::float AS net,
              factoring_client_owes($1)::float AS owes`, [id]);
    await c.query('COMMIT');
    return r.rows[0];
  } finally { c.release(); }
}

describe.runIf(enabled)('reserve less short payment (V016)', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    await owner.query(`INSERT INTO companies (id,name,slug) VALUES ($1,'Reserve Test','reserve-v016'),($2,'Other V016','other-v016')
                       ON CONFLICT (id) DO NOTHING`, [CO, OTHER]);
    await owner.query(`INSERT INTO fee_schedules (id,name,tier_mode,advance_rate_pct,recourse_days)
                       VALUES ($1,'Flat 2% V016','step',80,90) ON CONFLICT (id) DO NOTHING`, [SCHEDULE]);
    await owner.query(`DELETE FROM fee_schedule_tiers WHERE fee_schedule_id = $1`, [SCHEDULE]);
    await owner.query(`INSERT INTO fee_schedule_tiers (fee_schedule_id,from_day,to_day,fee_pct) VALUES ($1,0,NULL,2.0)`, [SCHEDULE]);
    await owner.query(`INSERT INTO factoring_debtors (id, legal_name) VALUES ($1,'Agency V016') ON CONFLICT (id) DO NOTHING`, [DEBTOR]);
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

  it('paid in full: reserve less fees', async () => {
    await advance('a1600000-0000-0000-0000-000000000001', { collected: true, received: 10000 });
    expect(await figures(owner, 'a1600000-0000-0000-0000-000000000001')).toEqual({ shortfall: 0, net: 1800, owes: 0 });
  });

  it('short-paid: the shortfall comes out of the reserve too', async () => {
    await advance('a1600000-0000-0000-0000-000000000002', { collected: true, received: 9500 });
    expect(await figures(owner, 'a1600000-0000-0000-0000-000000000002')).toEqual({ shortfall: 500, net: 1300, owes: 0 });
  });

  it('short by more than the reserve covers: nothing back, and the client owes the rest', async () => {
    await advance('a1600000-0000-0000-0000-000000000003', { collected: true, received: 7000 });
    expect(await figures(owner, 'a1600000-0000-0000-0000-000000000003')).toEqual({ shortfall: 3000, net: 0, owes: 1200 });
  });

  it('not yet paid, or paid with no amount recorded: no shortfall assumed', async () => {
    await advance('a1600000-0000-0000-0000-000000000004');
    expect(await figures(owner, 'a1600000-0000-0000-0000-000000000004')).toEqual({ shortfall: 0, net: 1800, owes: 0 });
    await advance('a1600000-0000-0000-0000-000000000005', { collected: true, received: null });
    expect((await figures(owner, 'a1600000-0000-0000-0000-000000000005')).shortfall).toBe(0);
  });

  it('the client sees the same figure for its own advance, and nothing for anyone else’s', async () => {
    expect(await figures(app, 'a1600000-0000-0000-0000-000000000002', CO)).toEqual({ shortfall: 500, net: 1300, owes: 0 });
    const other = await figures(app, 'a1600000-0000-0000-0000-000000000002', OTHER).catch((e: Error) => e);
    // Row security hides the advance (null), or the fee function refuses outright.
    if (other instanceof Error) expect(other.message).toMatch(/not permitted/i);
    else expect(other).toEqual({ shortfall: null, net: null, owes: null });
  });
});
