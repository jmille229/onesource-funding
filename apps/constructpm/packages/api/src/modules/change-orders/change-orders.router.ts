import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/query-params.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const changeOrdersRouter = Router();

const schema = z.object({
  job_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  amount: z.number(),
  cost_impact: z.number().default(0),
  time_impact_days: z.number().int().default(0),
  customer_id: z.string().uuid().optional().nullable(),
});

changeOrdersRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const db = createRlsClient(readPool, req.auth.companyId);
  const conds = ['co.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (job_id) { params.push(job_id); conds.push(`co.job_id=$${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT co.*,c.name customer_name FROM change_orders co LEFT JOIN contacts c ON c.id=co.customer_id WHERE ${conds.join(' AND ')} ORDER BY co.created_at DESC LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

changeOrdersRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(`SELECT co.*,c.name customer_name FROM change_orders co LEFT JOIN contacts c ON c.id=co.customer_id WHERE co.id=$1 AND co.deleted_at IS NULL`, [req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Change order not found' }); return; }
  res.json({ data: r.rows[0] });
}));

changeOrdersRouter.post('/', requireRole('owner','admin','project_manager'), validate(schema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof schema>;
  const id = await withTransaction(req.auth.companyId, async (client) => {
    const c = await client.query<{ count: string }>(`SELECT COUNT(*)+1 AS count FROM change_orders WHERE job_id=$1`, [body.job_id]);
    const r = await client.query<{ id: string }>(`INSERT INTO change_orders (company_id,job_id,number,title,description,status,amount,cost_impact,time_impact_days,customer_id,created_by) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10) RETURNING id`, [req.auth.companyId, body.job_id, parseInt(c.rows[0]?.count ?? '1'), body.title, body.description ?? null, body.amount, body.cost_impact, body.time_impact_days, body.customer_id ?? null, req.auth.userId]);
    return r.rows[0]!.id;
  });
  const co = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM change_orders WHERE id=$1`, [id]);
  res.status(201).json({ data: co.rows[0] });
}));

changeOrdersRouter.patch('/:id/status', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const { status } = req.body as { status: string };
  const allowed = ['sent','approved','rejected','void'];
  if (!allowed.includes(status)) { res.status(422).json({ error: 'validation_error', message: `Status must be one of: ${allowed.join(', ')}` }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  // SECURITY: approved_by is bound as $3, never interpolated. It comes from a
  // signed JWT today, but interpolating identifiers into SQL is the pattern that
  // turns a future refactor into an injection.
  const approving = status === 'approved';
  const r = await db.query(
    `UPDATE change_orders SET status=$2${approving ? ',approved_by=$3,approved_at=NOW()' : ''},updated_at=NOW() WHERE id=$1 RETURNING *`,
    approving ? [req.params['id'], status, req.auth.userId] : [req.params['id'], status]
  );
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Change order not found' }); return; }
  res.json({ data: r.rows[0] });
}));

changeOrdersRouter.delete('/:id', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  await db.query(`UPDATE change_orders SET deleted_at=NOW() WHERE id=$1`, [req.params['id']]);
  res.status(204).send();
}));
