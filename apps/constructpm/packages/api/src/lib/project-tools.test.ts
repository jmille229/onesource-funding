/**
 * V018: who keeps the project tools on. Re-runs the migration's SQL (it only
 * touches companies with no setting yet) against a few kinds of company.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const OWNER_URL = process.env['TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(here, '../../../db/migrations/V018__project_tools_optional.sql'), 'utf8');

const CO = {
  manual: 'f1900000-0000-0000-0000-000000000001',   // a job someone made by hand
  auto: 'f1900000-0000-0000-0000-000000000002',     // only jobs the old funding form made
  autoUsed: 'f1900000-0000-0000-0000-000000000003', // an automatic job with real project data
  chose: 'f1900000-0000-0000-0000-000000000004',    // already chose "off"
  none: 'f1900000-0000-0000-0000-000000000005',     // no jobs at all
};
const user = (co: string) => co.replace(/^f19/, 'e19');

let owner: pg.Pool;

async function job(co: string, name: string, number: string) {
  const r = await owner.query(`INSERT INTO jobs (company_id, name, job_number, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [co, name, number, user(co)]);
  return r.rows[0].id as string;
}
const toolsOn = async (co: string) =>
  (await owner.query(`SELECT settings->'project_tools' AS v FROM companies WHERE id = $1`, [co])).rows[0].v as boolean | null;

describe.runIf(Boolean(OWNER_URL))('project tools default (V018)', () => {
  let autoInvoice: string;
  let numberedInvoice: string;

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    for (const [k, co] of Object.entries(CO)) {
      await owner.query(`INSERT INTO companies (id, name, slug, settings) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [co, `V018 ${k}`, `v018-${k}`, k === 'chose' ? { project_tools: false } : {}]);
      await owner.query(`INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
                         VALUES ($1,$2,$3,'x','T','U','owner') ON CONFLICT (id) DO NOTHING`, [user(co), co, `${k}@v018.test`]);
    }
    await job(CO.manual, 'Bridge deck repair', 'BDR-1');
    const auto1 = await job(CO.auto, 'Navy NAVFAC · N40085-26-C-0001', 'N40085-26-C-0001');
    const auto2 = await job(CO.auto, 'GSA Region 3 — funded invoices', 'JOB-0003');
    const used = await job(CO.autoUsed, 'PennDOT · E04117', 'E04117');
    await owner.query(`INSERT INTO tasks (company_id, job_id, name, created_by) VALUES ($1,$2,'Pour deck',$3)`, [CO.autoUsed, used, user(CO.autoUsed)]);
    await job(CO.chose, 'Warehouse fit-out', 'WF-1');

    const contact = await owner.query(`INSERT INTO contacts (company_id, name) VALUES ($1,'Navy NAVFAC') RETURNING id`, [CO.auto]);
    const inv = (jobId: string, n: string) => owner.query(
      `INSERT INTO invoices (company_id, job_id, customer_id, invoice_number, due_date, total, created_by)
       VALUES ($1,$2,$3,$4,'2026-12-01',100,$5) RETURNING id`, [CO.auto, jobId, contact.rows[0].id, n, user(CO.auto)]);
    autoInvoice = (await inv(auto1, 'N-1')).rows[0].id;
    numberedInvoice = (await inv(auto2, 'N-2')).rows[0].id;

    await owner.query(MIGRATION);
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM companies WHERE id = ANY($1)`, [Object.values(CO)]).catch(() => {});
    await owner?.end().catch(() => {});
  });

  it('stays on for a company with a job it made itself', async () => {
    expect(await toolsOn(CO.manual)).toBe(true);
  });
  it('stays on when an automatic job has real project data on it', async () => {
    expect(await toolsOn(CO.autoUsed)).toBe(true);
  });
  it('is left off (unset) with only the automatic funding jobs, or no jobs', async () => {
    expect(await toolsOn(CO.auto)).toBeNull();
    expect(await toolsOn(CO.none)).toBeNull();
  });
  it('never overrides a choice already made', async () => {
    expect(await toolsOn(CO.chose)).toBe(false);
  });
  it('moves the contract number from an automatic job onto its invoices', async () => {
    const r = await owner.query(`SELECT id, contract_reference FROM invoices WHERE id = ANY($1)`, [[autoInvoice, numberedInvoice]]);
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x.contract_reference]));
    expect(by[autoInvoice]).toBe('N40085-26-C-0001');
    expect(by[numberedInvoice]).toBeNull();   // "JOB-0003" was never a contract number
  });
});
