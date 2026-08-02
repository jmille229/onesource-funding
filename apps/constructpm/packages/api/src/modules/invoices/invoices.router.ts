import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const invoicesRouter = Router();

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  budget_item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.number().min(0).default(1),
  unit_price: z.number().min(0),
});

const schema = z.object({
  job_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  issue_date: z.string().default(() => new Date().toISOString().split('T')[0]!),
  due_date: z.string(),
  tax_rate: z.number().min(0).max(100).default(0),
  notes: z.string().optional().nullable(),
  items: z.array(lineSchema).min(1),
});

invoicesRouter.get('/', asyncHandler(async (req, res) => {
  const { job_id, status } = req.query as Record<string, string>;
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['i.deleted_at IS NULL'];
  if (job_id) { params.push(job_id); conds.push(`i.job_id=$${params.length}`); }
  if (status) { params.push(status); conds.push(`i.status=$${params.length}`); }
  const r = await db.query(`SELECT i.*,c.name customer_name FROM invoices i LEFT JOIN contacts c ON c.id=i.customer_id WHERE ${conds.join(' AND ')} ORDER BY i.issue_date DESC`, params);
  res.json({ data: r.rows });
}));

invoicesRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [inv, items] = await Promise.all([
    db.query(`SELECT i.*,c.name customer_name,c.email customer_email,c.address_line1 customer_address FROM invoices i LEFT JOIN contacts c ON c.id=i.customer_id WHERE i.id=$1 AND i.deleted_at IS NULL`, [req.params['id']]),
    db.query(`SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order`, [req.params['id']]),
  ]);
  if (!inv.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Invoice not found' }); return; }
  res.json({ data: { ...inv.rows[0], items: items.rows } });
}));

invoicesRouter.post('/', requireRole('owner','admin','project_manager','accountant'), validate(schema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof schema>;
  const id = await withTransaction(req.auth.companyId, async (client) => {
    const cnt = await client.query<{ count: string }>(`SELECT COUNT(*)+1 count FROM invoices WHERE company_id=$1`, [req.auth.companyId]);
    const num = `INV-${String(parseInt(cnt.rows[0]?.count ?? '1')).padStart(4, '0')}`;
    const subtotal = body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const taxAmt = subtotal * (body.tax_rate / 100);
    const total = subtotal + taxAmt;
    const r = await client.query<{ id: string }>(`INSERT INTO invoices (company_id,job_id,customer_id,invoice_number,status,issue_date,due_date,subtotal,tax_rate,tax_amount,total,paid_amount,balance_due,notes,created_by) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,0,$10,$11,$12) RETURNING id`, [req.auth.companyId, body.job_id, body.customer_id, num, body.issue_date, body.due_date, subtotal.toFixed(2), body.tax_rate, taxAmt.toFixed(2), total.toFixed(2), body.notes ?? null, req.auth.userId]);
    const invId = r.rows[0]!.id;
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i]!;
      await client.query(`INSERT INTO invoice_items (company_id,invoice_id,budget_item_id,description,quantity,unit_price,amount,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.auth.companyId, invId, item.budget_item_id ?? null, item.description, item.quantity, item.unit_price, (item.quantity * item.unit_price).toFixed(2), i]);
    }
    return invId;
  });
  const inv = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM invoices WHERE id=$1`, [id]);
  res.status(201).json({ data: inv.rows[0] });
}));

invoicesRouter.patch('/:id/send', requireRole('owner','admin','accountant'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE invoices SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`, [req.params['id']]);
  if (!r.rows[0]) { res.status(409).json({ error: 'conflict', message: 'Only draft invoices can be sent' }); return; }
  res.json({ data: r.rows[0] });
}));

invoicesRouter.patch('/:id/record-payment', requireRole('owner','admin','accountant'), asyncHandler(async (req, res) => {
  const { amount } = req.body as { amount: number };
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `UPDATE invoices SET
       paid_amount = paid_amount + $2,
       balance_due = total - (paid_amount + $2),
       status = CASE WHEN (paid_amount + $2) >= total THEN 'paid' ELSE 'partially_paid' END,
       updated_at = NOW()
     WHERE id=$1 RETURNING *`,
    [req.params['id'], amount]
  );
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Invoice not found' }); return; }
  res.json({ data: r.rows[0] });
}));

invoicesRouter.patch('/:id/void', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE invoices SET status='void',updated_at=NOW() WHERE id=$1 AND status NOT IN ('paid','void') RETURNING *`, [req.params['id']]);
  if (!r.rows[0]) { res.status(409).json({ error: 'conflict', message: 'Invoice cannot be voided' }); return; }
  res.json({ data: r.rows[0] });
}));
