import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { enumParam, uuidParam } from '../../lib/query-params.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const purchaseOrdersRouter = Router();

const PO_STATUSES = ['draft','sent','acknowledged','partially_billed','fully_billed','closed'] as const;

const poSchema = z.object({
  job_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  description: z.string().optional().nullable(),
  issue_date: z.string().default(() => new Date().toISOString().split('T')[0]!),
  expected_delivery: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    id: z.string().uuid().optional(),
    budget_item_id: z.string().uuid().optional().nullable(),
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    quantity: z.number().min(0),
    unit: z.string().optional().nullable(),
    unit_cost: z.number().min(0),
  })).default([]),
});

purchaseOrdersRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const db = createRlsClient(readPool, req.auth.companyId);
  const conds = ['po.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (job_id) { params.push(job_id); conds.push(`po.job_id=$${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT po.*,c.name vendor_name FROM purchase_orders po LEFT JOIN contacts c ON c.id=po.vendor_id WHERE ${conds.join(' AND ')} ORDER BY po.created_at DESC LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

purchaseOrdersRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [po, items] = await Promise.all([
    db.query(`SELECT po.*,c.name vendor_name FROM purchase_orders po LEFT JOIN contacts c ON c.id=po.vendor_id WHERE po.id=$1 AND po.deleted_at IS NULL`, [req.params['id']]),
    db.query(`SELECT * FROM po_items WHERE purchase_order_id=$1 ORDER BY sort_order`, [req.params['id']]),
  ]);
  if (!po.rows[0]) { res.status(404).json({ error: 'not_found', message: 'PO not found' }); return; }
  res.json({ data: { ...po.rows[0], items: items.rows } });
}));

purchaseOrdersRouter.post('/', requireRole('owner','admin','project_manager','accountant'), validate(poSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof poSchema>;
  const id = await withTransaction(req.auth.companyId, async (client) => {
    const cnt = await client.query<{ count: string }>(`SELECT COUNT(*)+1 count FROM purchase_orders WHERE company_id=$1`, [req.auth.companyId]);
    const num = `PO-${String(parseInt(cnt.rows[0]?.count ?? '1')).padStart(4, '0')}`;
    const subtotal = body.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
    const r = await client.query<{ id: string }>(`INSERT INTO purchase_orders (company_id,job_id,number,status,vendor_id,description,issue_date,expected_delivery,subtotal,total,notes,created_by) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$8,$9,$10) RETURNING id`, [req.auth.companyId, body.job_id, num, body.vendor_id, body.description ?? null, body.issue_date, body.expected_delivery ?? null, subtotal.toFixed(2), body.notes ?? null, req.auth.userId]);
    const poId = r.rows[0]!.id;
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i]!;
      const ext = item.quantity * item.unit_cost;
      await client.query(`INSERT INTO po_items (company_id,purchase_order_id,budget_item_id,name,description,quantity,unit,unit_cost,ext_cost,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [req.auth.companyId, poId, item.budget_item_id ?? null, item.name, item.description ?? null, item.quantity, item.unit ?? null, item.unit_cost, ext.toFixed(2), i]);
    }
    return poId;
  });
  const po = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM purchase_orders WHERE id=$1`, [id]);
  res.status(201).json({ data: po.rows[0] });
}));

purchaseOrdersRouter.patch('/:id/status', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  // Was unvalidated: an unknown status cast to the po_status enum and came back
  // as a 500. changeOrders already guarded this; purchaseOrders did not.
  const status = enumParam((req.body as { status?: unknown }).status, PO_STATUSES, 'status');
  if (!status) { res.status(422).json({ error: 'validation_error', message: 'status is required' }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE purchase_orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params['id'], status]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'PO not found' }); return; }
  res.json({ data: r.rows[0] });
}));
