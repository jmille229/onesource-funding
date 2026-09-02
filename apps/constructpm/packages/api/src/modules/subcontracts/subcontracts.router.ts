import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { enumParam, uuidParam } from '../../lib/query-params.js';
import { buildUpdateSet } from '../../lib/sql.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const subcontractsRouter = Router();

const SUBCONTRACT_STATUSES = ['draft','active','complete','closed','void'] as const;

// SECURITY: explicit allowlist for the dynamic PATCH (see SECURITY.md — every
// dynamic UPDATE goes through buildUpdateSet). The previous code interpolated
// Object.keys(body) directly; Zod's strip mode made that safe in practice, but
// the rule exists so safety does not depend on remembering which schema mode
// is in force. company_id, id and created_by are deliberately absent.
const PATCHABLE_SUBCONTRACT_COLUMNS = [
  'job_id', 'subcontractor_id', 'subcontract_number', 'title', 'cost_code', 'scope',
  'contract_amount', 'retainage_pct', 'status', 'start_date', 'end_date', 'executed_date', 'notes',
] as const;

const subSchema = z.object({
  job_id: z.string().uuid(),
  subcontractor_id: z.string().uuid(),
  subcontract_number: z.string().max(50).optional().nullable(),
  title: z.string().min(1).max(200),
  cost_code: z.string().max(50).optional().nullable(),
  scope: z.string().optional().nullable(),
  contract_amount: z.number().min(0).default(0),
  retainage_pct: z.number().min(0).max(100).default(10),
  status: z.enum(['draft', 'active', 'complete', 'closed', 'void']).default('draft'),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  executed_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Commitment figures derived from linked pay applications (vendor_bills).
const TOTALS_JOIN = `
  LEFT JOIN (
    SELECT subcontract_id,
           SUM(total)            AS billed,
           SUM(retainage_amount) AS retainage_held,
           SUM(paid_amount)      AS paid
    FROM vendor_bills
    WHERE subcontract_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY subcontract_id
  ) b ON b.subcontract_id = s.id`;

const SELECT_COLS = `
  s.*, c.name AS subcontractor_name, c.certifications,
  COALESCE(b.billed,0)         AS billed,
  COALESCE(b.retainage_held,0) AS retainage_held,
  COALESCE(b.paid,0)           AS paid,
  COALESCE(b.billed,0) - COALESCE(b.retainage_held,0) - COALESCE(b.paid,0) AS due,
  s.contract_amount - COALESCE(b.billed,0) AS remaining`;

/** Coerce pg NUMERIC (returned as strings) to numbers on the derived/money fields. */
function coerce(row: Record<string, unknown>) {
  for (const k of ['contract_amount', 'retainage_pct', 'billed', 'retainage_held', 'paid', 'due', 'remaining']) {
    if (row[k] != null) row[k] = Number(row[k]);
  }
  return row;
}

// GET /api/subcontracts?job_id=&status=
subcontractsRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const status = enumParam(req.query['status'], SUBCONTRACT_STATUSES, 'status');
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['s.deleted_at IS NULL'];
  if (job_id) { params.push(job_id); conds.push(`s.job_id = $${params.length}`); }
  if (status) { params.push(status); conds.push(`s.status = $${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(
    `SELECT ${SELECT_COLS}
     FROM subcontracts s
     JOIN contacts c ON c.id = s.subcontractor_id
     ${TOTALS_JOIN}
     WHERE ${conds.join(' AND ')}
     ORDER BY s.subcontract_number NULLS LAST, s.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json({ data: r.rows.map(coerce) });
}));

// GET /api/subcontracts/participation?job_id=
// MBE/WBE/DBE participation: certified committed value / total committed value.
subcontractsRouter.get('/participation', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const cond = job_id ? (params.push(job_id), `AND s.job_id = $${params.length}`) : '';
  const totals = await db.query<{ total_committed: string; certified_committed: string }>(
    `SELECT COALESCE(SUM(s.contract_amount),0) AS total_committed,
            COALESCE(SUM(s.contract_amount) FILTER (WHERE array_length(c.certifications,1) IS NOT NULL),0) AS certified_committed
     FROM subcontracts s JOIN contacts c ON c.id = s.subcontractor_id
     WHERE s.deleted_at IS NULL ${cond}`,
    params
  );
  const byCert = await db.query<{ certification: string; committed: string }>(
    `SELECT cert AS certification, COALESCE(SUM(s.contract_amount),0) AS committed
     FROM subcontracts s JOIN contacts c ON c.id = s.subcontractor_id, unnest(c.certifications) AS cert
     WHERE s.deleted_at IS NULL ${cond}
     GROUP BY cert ORDER BY committed DESC`,
    params
  );
  const total = Number(totals.rows[0]?.total_committed ?? 0);
  const certified = Number(totals.rows[0]?.certified_committed ?? 0);
  res.json({
    data: {
      total_committed: total,
      certified_committed: certified,
      participation_pct: total ? Math.round((certified / total) * 100) : 0,
      by_certification: byCert.rows.map((r) => ({ certification: r.certification, committed: Number(r.committed) })),
    },
  });
}));

// GET /api/subcontracts/:id
subcontractsRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT ${SELECT_COLS}
     FROM subcontracts s
     JOIN contacts c ON c.id = s.subcontractor_id
     ${TOTALS_JOIN}
     WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [req.params['id']]
  );
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Subcontract not found' }); return; }
  res.json({ data: coerce(r.rows[0]) });
}));

// POST /api/subcontracts
subcontractsRouter.post('/', requireRole('owner', 'admin', 'project_manager'),
  validate(subSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof subSchema>;
    const id = await withTransaction(req.auth.companyId, async (client) => {
      let num = body.subcontract_number;
      if (!num) {
        // MAX of the existing SC-nnnn suffixes, not COUNT(*)+1 — the count
        // drifts from the max as soon as anyone supplies their own number, and
        // the generated value then collides with UNIQUE (company_id, job_id,
        // subcontract_number). A true concurrent race still lands as 23505 and
        // is reported as 409 below rather than a 500.
        const c = await client.query<{ next: string }>(
          `SELECT COALESCE(MAX(NULLIF(regexp_replace(subcontract_number, '^SC-', ''), subcontract_number)::int), 0) + 1 AS next
             FROM subcontracts WHERE job_id = $1 AND subcontract_number ~ '^SC-[0-9]+$'`,
          [body.job_id]
        );
        num = `SC-${String(c.rows[0]?.next ?? 1).padStart(4, '0')}`;
      }
      const r = await client.query<{ id: string }>(
        `INSERT INTO subcontracts
           (company_id, job_id, subcontractor_id, subcontract_number, title, cost_code, scope,
            contract_amount, retainage_pct, status, start_date, end_date, executed_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [req.auth.companyId, body.job_id, body.subcontractor_id, num, body.title, body.cost_code ?? null,
         body.scope ?? null, body.contract_amount, body.retainage_pct, body.status, body.start_date ?? null,
         body.end_date ?? null, body.executed_date ?? null, body.notes ?? null, req.auth.userId]
      );
      return r.rows[0]!.id;
    }).catch((err: { code?: string }) => {
      if (err.code === '23505') {
        throw Object.assign(new Error('A subcontract with that number already exists on this job — try again'), { status: 409 });
      }
      throw err;
    });
    const created = await createRlsClient(readPool, req.auth.companyId)
      .query(`SELECT * FROM subcontracts WHERE id = $1`, [id]);
    res.status(201).json({ data: created.rows[0] });
  }));

// PATCH /api/subcontracts/:id
subcontractsRouter.patch('/:id', requireRole('owner', 'admin', 'project_manager'),
  validate(subSchema.partial()), asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { clause, values } = buildUpdateSet(body, PATCHABLE_SUBCONTRACT_COLUMNS);
    if (!clause) { res.status(422).json({ error: 'validation_error', message: 'Nothing to update' }); return; }
    const db = createRlsClient(writePool, req.auth.companyId);
    const r = await db.query(
      `UPDATE subcontracts SET ${clause}, updated_at=NOW()
       WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params['id'], ...values]
    );
    if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Subcontract not found' }); return; }
    res.json({ data: r.rows[0] });
  }));

// DELETE /api/subcontracts/:id
subcontractsRouter.delete('/:id', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `UPDATE subcontracts SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
    [req.params['id']]
  );
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Subcontract not found' }); return; }
  res.status(204).send();
}));
