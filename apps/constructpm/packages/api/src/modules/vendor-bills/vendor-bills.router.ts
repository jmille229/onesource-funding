import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/query-params.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const vendorBillsRouter = Router();

const schema = z.object({
  job_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  bill_number: z.string().optional().nullable(),
  bill_date: z.string().default(() => new Date().toISOString().split('T')[0]!),
  due_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    budget_item_id: z.string().uuid().optional().nullable(),
    name: z.string().min(1),
    quantity: z.number().min(0),
    unit_cost: z.number().min(0),
  })).default([]),
});

vendorBillsRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['vb.deleted_at IS NULL'];
  if (job_id) { params.push(job_id); conds.push(`vb.job_id=$${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT vb.*,c.name vendor_name FROM vendor_bills vb LEFT JOIN contacts c ON c.id=vb.vendor_id WHERE ${conds.join(' AND ')} ORDER BY vb.bill_date DESC LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

vendorBillsRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [bill, items] = await Promise.all([
    db.query(`SELECT vb.*,c.name vendor_name FROM vendor_bills vb LEFT JOIN contacts c ON c.id=vb.vendor_id WHERE vb.id=$1 AND vb.deleted_at IS NULL`, [req.params['id']]),
    db.query(`SELECT * FROM vendor_bill_items WHERE vendor_bill_id=$1 ORDER BY sort_order`, [req.params['id']]),
  ]);
  if (!bill.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Bill not found' }); return; }
  res.json({ data: { ...bill.rows[0], items: items.rows } });
}));

vendorBillsRouter.post('/', requireRole('owner','admin','project_manager','accountant'), validate(schema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof schema>;
  const id = await withTransaction(req.auth.companyId, async (client) => {
    const subtotal = body.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
    const r = await client.query<{ id: string }>(`INSERT INTO vendor_bills (company_id,job_id,vendor_id,purchase_order_id,bill_number,status,bill_date,due_date,subtotal,total,notes,created_by) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$8,$9,$10) RETURNING id`, [req.auth.companyId, body.job_id, body.vendor_id, body.purchase_order_id ?? null, body.bill_number ?? null, body.bill_date, body.due_date ?? null, subtotal.toFixed(2), body.notes ?? null, req.auth.userId]);
    const billId = r.rows[0]!.id;
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i]!;
      await client.query(`INSERT INTO vendor_bill_items (company_id,vendor_bill_id,budget_item_id,name,quantity,unit_cost,ext_cost,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.auth.companyId, billId, item.budget_item_id ?? null, item.name, item.quantity, item.unit_cost, (item.quantity * item.unit_cost).toFixed(2), i]);
    }
    return billId;
  });
  const bill = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM vendor_bills WHERE id=$1`, [id]);
  res.status(201).json({ data: bill.rows[0] });
}));

vendorBillsRouter.patch('/:id/approve', requireRole('owner','admin','accountant'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE vendor_bills SET status='approved',approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`, [req.params['id'], req.auth.userId]);
  if (!r.rows[0]) { res.status(409).json({ error: 'conflict', message: 'Bill cannot be approved in current state' }); return; }
  res.json({ data: r.rows[0] });
}));

vendorBillsRouter.patch('/:id/pay', requireRole('owner','admin','accountant'), asyncHandler(async (req, res) => {
  const { paid_amount } = req.body as { paid_amount: number };
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE vendor_bills SET status='paid',paid_amount=$2,updated_at=NOW() WHERE id=$1 AND status='approved' RETURNING *`, [req.params['id'], paid_amount]);
  if (!r.rows[0]) { res.status(409).json({ error: 'conflict', message: 'Bill must be approved before payment' }); return; }
  res.json({ data: r.rows[0] });
}));
