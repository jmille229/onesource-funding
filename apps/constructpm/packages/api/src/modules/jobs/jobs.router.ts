import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { buildUpdateSet } from '../../lib/sql.js';
import { parsePagination, escapeLike } from '../../lib/pagination.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const jobsRouter = Router();

const JOB_STATUSES = ['lead','bidding','awarded','active','on_hold','substantially_complete','closed','cancelled'] as const;

const jobSchema = z.object({
  name: z.string().min(1).max(200),
  job_number: z.string().max(50).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(JOB_STATUSES).default('lead'),
  contract_type: z.enum(['lump_sum','gmp','cost_plus_fixed','cost_plus_pct','time_and_materials','unit_price']).default('lump_sum'),
  contract_amount: z.number().min(0).optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state_code: z.string().length(2).optional().nullable(),
  zip: z.string().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  project_manager_id: z.string().uuid().optional().nullable(),
  retainage_pct: z.number().min(0).max(100).default(10),
  prevailing_wage_required: z.boolean().default(false),
});

// Postgres returns SUM()/COUNT() as strings, not numbers.
type JobFinancialRow = { budget: string; price: string; committed: string; actual: string; invoiced: string };
type JobTaskCountRow = { total: string; completed: string; in_progress: string };

// SECURITY: Explicit allowlist for the dynamic PATCH. Zod already strips unknown
// keys, but naming the columns here means the SET clause can never depend on the
// schema staying in sync — and company_id/id can never be reassigned.
const PATCHABLE_JOB_COLUMNS = [
  'name', 'job_number', 'description', 'status', 'contract_type', 'contract_amount',
  'start_date', 'end_date', 'address_line1', 'city', 'state_code', 'zip',
  'customer_id', 'project_manager_id', 'retainage_pct', 'prevailing_wage_required',
] as const;

// GET /api/jobs
jobsRouter.get('/', asyncHandler(async (req, res) => {
  const { status, search } = req.query as Record<string,string>;
  // Clamped: per_page=999999999 was an unbounded query, page=0 a negative
  // OFFSET that Postgres rejected as a 500.
  const { page: pg_num, per_page: pp, limit, offset } =
    parsePagination(req.query, { defaultPerPage: 25, maxPerPage: 200 });
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['j.deleted_at IS NULL'];
  if (status) {
    // An unknown value would fail the enum cast inside Postgres and surface as
    // a 500; say 422 here instead.
    if (!(JOB_STATUSES as readonly string[]).includes(status)) {
      res.status(422).json({ error: 'validation_error', message: 'Unknown job status' });
      return;
    }
    params.push(status); conds.push(`j.status = $${params.length}`);
  }
  if (search) { params.push(`%${escapeLike(search)}%`); conds.push(`(j.name ILIKE $${params.length} OR j.job_number ILIKE $${params.length})`); }
  params.push(limit, offset);
  const [rows, cnt] = await Promise.all([
    db.query(
      `SELECT j.*, c.name AS customer_name, u.first_name||' '||u.last_name AS project_manager_name,
        COALESCE(b.total_budget,0) AS total_budget, COALESCE(b.total_price,0) AS total_price
       FROM jobs j
       LEFT JOIN contacts c ON c.id=j.customer_id
       LEFT JOIN users u ON u.id=j.project_manager_id
       LEFT JOIN (SELECT job_id,SUM(ext_cost) AS total_budget,SUM(ext_price) AS total_price FROM budget_items WHERE deleted_at IS NULL GROUP BY job_id) b ON b.job_id=j.id
       WHERE ${conds.join(' AND ')} ORDER BY j.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    ),
    db.query<{count:string}>(`SELECT COUNT(*) AS count FROM jobs j WHERE ${conds.join(' AND ')}`, params.slice(0,-2)),
  ]);
  res.json({ data: rows.rows, meta: { total: parseInt(cnt.rows[0]?.count??'0'), page: pg_num, per_page: pp } });
}));

// GET /api/jobs/:id
jobsRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT j.*, c.name AS customer_name, c.email AS customer_email,
       u.first_name||' '||u.last_name AS project_manager_name,
       COALESCE(b.total_budget,0) AS total_budget, COALESCE(b.total_price,0) AS total_price,
       COALESCE(dep.committed,0) AS committed_cost, COALESCE(dep.actual,0) AS actual_cost
     FROM jobs j
     LEFT JOIN contacts c ON c.id=j.customer_id
     LEFT JOIN users u ON u.id=j.project_manager_id
     LEFT JOIN (SELECT job_id,SUM(ext_cost) total_budget,SUM(ext_price) total_price FROM budget_items WHERE deleted_at IS NULL GROUP BY job_id) b ON b.job_id=j.id
     LEFT JOIN (SELECT bi.job_id,SUM(d.committed_amount) committed,SUM(d.actual_amount) actual FROM budget_item_depletion_summary d JOIN budget_items bi ON bi.id=d.budget_item_id GROUP BY bi.job_id) dep ON dep.job_id=j.id
     WHERE j.id=$1 AND j.deleted_at IS NULL`, [req.params['id']]
  );
  if (!r.rows[0]) { res.status(404).json({ error:'not_found',message:'Job not found' }); return; }
  res.json({ data: r.rows[0] });
}));

// POST /api/jobs
jobsRouter.post('/', requireRole('owner','admin','project_manager'), validate(jobSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof jobSchema>;
  const jobId = await withTransaction(req.auth.companyId, async (client) => {
    let num = body.job_number;
    if (!num) {
      // Next number from the highest existing JOB-nnnn, not COUNT(*)+1: a
      // count drifts from the max as soon as anyone supplies their own number
      // or a numbered job is deleted, and then the generated value collides
      // with UNIQUE (company_id, job_number). Two simultaneous creates can still
      // race to the same number; that lands as 23505 and is reported as a 409
      // below rather than a 500.
      const c = await client.query<{ next: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(job_number, '^JOB-', ''), job_number)::int), 0) + 1 AS next
           FROM jobs WHERE company_id = $1 AND job_number ~ '^JOB-[0-9]+$'`,
        [req.auth.companyId]);
      num = `JOB-${String(c.rows[0]?.next ?? 1).padStart(4,'0')}`;
    }
    const r = await client.query<{id:string}>(
      `INSERT INTO jobs (company_id,name,job_number,description,status,contract_type,contract_amount,start_date,end_date,address_line1,city,state_code,zip,customer_id,project_manager_id,retainage_pct,prevailing_wage_required,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [req.auth.companyId,body.name,num,body.description??null,body.status,body.contract_type,body.contract_amount??null,body.start_date??null,body.end_date??null,body.address_line1??null,body.city??null,body.state_code??null,body.zip??null,body.customer_id??null,body.project_manager_id??null,body.retainage_pct,body.prevailing_wage_required,req.auth.userId]
    );
    const jid = r.rows[0]!.id;
    await client.query(`INSERT INTO budgets (company_id,job_id,name,status,created_by) VALUES ($1,$2,'Primary Budget','active',$3)`,[req.auth.companyId,jid,req.auth.userId]);
    return jid;
  }).catch((err: { code?: string }) => {
    if (err.code === '23505') {
      throw Object.assign(new Error('A job with that number already exists — try again'), { status: 409 });
    }
    throw err;
  });
  const job = await createRlsClient(readPool,req.auth.companyId).query(`SELECT * FROM jobs WHERE id=$1`,[jobId]);
  res.status(201).json({ data: job.rows[0] });
}));

// PATCH /api/jobs/:id
jobsRouter.patch('/:id', requireRole('owner','admin','project_manager'), validate(jobSchema.partial()), asyncHandler(async (req, res) => {
  const body = req.body as Record<string,unknown>;
  const { clause, values } = buildUpdateSet(body, PATCHABLE_JOB_COLUMNS);
  if (!clause) { res.status(422).json({ error:'validation_error',message:'Nothing to update' }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE jobs SET ${clause},updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,[req.params['id'],...values]);
  if (!r.rows[0]) { res.status(404).json({ error:'not_found',message:'Job not found' }); return; }
  res.json({ data: r.rows[0] });
}));

// DELETE /api/jobs/:id
jobsRouter.delete('/:id', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE jobs SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,[req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error:'not_found',message:'Job not found' }); return; }
  res.status(204).send();
}));

// GET /api/jobs/:id/summary
jobsRouter.get('/:id/summary', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [fin, tasks] = await Promise.all([
    db.query<JobFinancialRow>(`SELECT COALESCE(SUM(bi.ext_cost),0) budget,COALESCE(SUM(bi.ext_price),0) price,COALESCE(SUM(d.committed_amount),0) committed,COALESCE(SUM(d.actual_amount),0) actual,COALESCE(SUM(d.invoiced_amount),0) invoiced FROM budget_items bi LEFT JOIN budget_item_depletion_summary d ON d.budget_item_id=bi.id WHERE bi.job_id=$1 AND bi.deleted_at IS NULL`,[req.params['id']]),
    db.query<JobTaskCountRow>(`SELECT COUNT(*) total,COUNT(*) FILTER (WHERE status='completed') completed,COUNT(*) FILTER (WHERE status='in_progress') in_progress FROM tasks WHERE job_id=$1 AND deleted_at IS NULL`,[req.params['id']]),
  ]);
  // Both aggregates always return one row, but defaulting keeps the response
  // numeric rather than NaN if a query ever comes back empty.
  const f = fin.rows[0]   ?? { budget:'0', price:'0', committed:'0', actual:'0', invoiced:'0' };
  const t = tasks.rows[0] ?? { total:'0', completed:'0', in_progress:'0' };
  const totalTasks = Number(t.total);
  res.json({ data: {
    financial: { budget: Number(f.budget), price: Number(f.price), committed: Number(f.committed), actual: Number(f.actual), invoiced: Number(f.invoiced) },
    tasks: { total: totalTasks, completed: Number(t.completed), in_progress: Number(t.in_progress), pct: totalTasks ? Math.round(Number(t.completed)/totalTasks*100) : 0 },
  } });
}));
