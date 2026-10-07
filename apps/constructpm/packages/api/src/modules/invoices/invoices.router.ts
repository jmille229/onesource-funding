import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { enumParam, uuidParam } from '../../lib/query-params.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';
import { SUBMISSION_METHODS } from '@constructpm/shared';

export const invoicesRouter = Router();

/**
 * Invoices are tracked here, not sent from here.
 *
 * A contractor bills the agency through whatever channel the agency uses — its
 * portal, email, mail. This module records each step of that process
 * (submitted → approved or returned → paid) so the contractor can see where
 * every invoice stands, and so One Source can see that an invoice is approved
 * before it is funded. Nothing in here contacts the agency.
 */

const INVOICE_STATUSES = [
  'draft','sent','viewed','approved','returned','partially_paid','paid','overdue','void',
] as const;

/** With the agency, awaiting a decision. 'viewed'/'overdue' are legacy states. */
const AWAITING = `('sent','viewed','overdue')`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date().toISOString().split('T')[0]!;

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  budget_item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity: z.number().min(0).default(1),
  unit_price: z.number().min(0),
});

const createSchema = z.object({
  job_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  /** The contractor's own invoice number. Blank → one is assigned. */
  invoice_number: z.string().trim().max(50).optional().nullable(),
  /** Logged after the fact ('sent', the default) or before submitting ('draft'). */
  status: z.enum(['draft', 'sent']).default('sent'),
  issue_date: isoDate.optional(),
  submitted_on: isoDate.optional().nullable(),
  submission_method: z.enum(SUBMISSION_METHODS).optional().nullable(),
  agency_reference: z.string().trim().max(100).optional().nullable(),
  due_date: isoDate.optional().nullable(),
  /** Invoice total, for invoices logged without line items. */
  amount: z.number().positive().optional(),
  tax_rate: z.number().min(0).max(100).default(0),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(lineSchema).optional(),
}).refine((b) => (b.items && b.items.length > 0) || b.amount !== undefined, {
  message: 'Enter the invoice amount or at least one line item',
  path: ['amount'],
});

const submitSchema = z.object({
  submitted_on: isoDate.optional(),
  submission_method: z.enum(SUBMISSION_METHODS).optional().nullable(),
  agency_reference: z.string().trim().max(100).optional().nullable(),
});

const approveSchema = z.object({ approved_on: isoDate.optional() });

const returnSchema = z.object({
  returned_on: isoDate.optional(),
  note: z.string().trim().max(2000).optional().nullable(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  paid_on: isoDate.optional(),
  reference: z.string().trim().max(100).optional().nullable(),
});

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

invoicesRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  const status = enumParam(req.query['status'], INVOICE_STATUSES, 'status');
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['i.deleted_at IS NULL'];
  if (job_id) { params.push(job_id); conds.push(`i.job_id=$${params.length}`); }
  if (status) { params.push(status); conds.push(`i.status=$${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(
    `SELECT i.*, c.name customer_name, j.name job_name, j.job_number,
            -- How many documents are on file, and whether any is proof of approval.
            (SELECT COUNT(*) FROM file_attachments fa
              WHERE fa.entity_type='invoice' AND fa.entity_id=i.id)::int AS document_count,
            EXISTS (SELECT 1 FROM file_attachments fa
              WHERE fa.entity_type='invoice' AND fa.entity_id=i.id
                AND fa.doc_type IN ('approved_invoice','approval_email','portal_screenshot','certified_pay_app'))
              AS has_approval_doc
       FROM invoices i
       LEFT JOIN contacts c ON c.id=i.customer_id
       LEFT JOIN jobs j ON j.id=i.job_id
      WHERE ${conds.join(' AND ')}
      ORDER BY COALESCE(i.submitted_on, i.issue_date) DESC, i.created_at DESC
      LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

invoicesRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [inv, items, payments] = await Promise.all([
    db.query(
      `SELECT i.*, c.name customer_name, c.email customer_email, c.address_line1 customer_address,
              j.name job_name, j.job_number
         FROM invoices i
         LEFT JOIN contacts c ON c.id=i.customer_id
         LEFT JOIN jobs j ON j.id=i.job_id
        WHERE i.id=$1 AND i.deleted_at IS NULL`, [req.params['id']]),
    db.query(`SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order`, [req.params['id']]),
    db.query(
      `SELECT p.id, p.amount, p.paid_on, p.reference, p.created_at,
              u.first_name || ' ' || u.last_name AS recorded_by_name
         FROM invoice_payments p LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.invoice_id=$1 ORDER BY p.paid_on, p.created_at`, [req.params['id']]),
  ]);
  if (!inv.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Invoice not found' }); return; }
  res.json({ data: { ...inv.rows[0], items: items.rows, payments: payments.rows } });
}));

invoicesRouter.post('/', requireRole('owner','admin','project_manager','accountant'), validate(createSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createSchema>;
  const issueDate = body.issue_date ?? body.submitted_on ?? today();
  const submittedOn = body.status === 'sent' ? (body.submitted_on ?? issueDate) : null;
  // Due date isn't something the contractor always knows; default to 30 days
  // after submission so aging still has an anchor.
  const dueDate = body.due_date
    ?? new Date(Date.parse(`${submittedOn ?? issueDate}T00:00:00Z`) + 30 * 86400_000).toISOString().split('T')[0]!;

  const id = await withTransaction(req.auth.companyId, async (client) => {
    let num = body.invoice_number?.trim() || null;
    if (!num) {
      const cnt = await client.query<{ count: string }>(`SELECT COUNT(*)+1 count FROM invoices WHERE company_id=$1`, [req.auth.companyId]);
      num = `INV-${String(parseInt(cnt.rows[0]?.count ?? '1')).padStart(4, '0')}`;
    }
    const items = body.items ?? [];
    const subtotal = items.length > 0
      ? items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
      : body.amount!;
    const taxAmt = subtotal * (body.tax_rate / 100);
    const total = subtotal + taxAmt;
    const r = await client.query<{ id: string }>(
      `INSERT INTO invoices
         (company_id,job_id,customer_id,invoice_number,status,issue_date,due_date,
          subtotal,tax_rate,tax_amount,total,paid_amount,balance_due,notes,created_by,
          submitted_on,submission_method,agency_reference,sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11,$12,$13,$14,$15,$16,
               CASE WHEN $5::invoice_status='sent' THEN NOW() END)
       RETURNING id`,
      [req.auth.companyId, body.job_id, body.customer_id, num, body.status, issueDate, dueDate,
       subtotal.toFixed(2), body.tax_rate, taxAmt.toFixed(2), total.toFixed(2), body.notes ?? null,
       req.auth.userId, submittedOn, body.submission_method ?? null, body.agency_reference ?? null]);
    const invId = r.rows[0]!.id;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      await client.query(
        `INSERT INTO invoice_items (company_id,invoice_id,budget_item_id,description,quantity,unit_price,amount,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.auth.companyId, invId, item.budget_item_id ?? null, item.description, item.quantity,
         item.unit_price, (item.quantity * item.unit_price).toFixed(2), i]);
    }
    return invId;
  });
  const inv = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM invoices WHERE id=$1`, [id]);
  res.status(201).json({ data: inv.rows[0] });
}));

/**
 * Record that the invoice was submitted to the agency (first time, or again
 * after it was returned for correction). Does not send anything.
 *
 * Also mounted at /send, the old name, so an older browser tab still works.
 */
const submitHandler = asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof submitSchema>;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `UPDATE invoices SET status='sent', sent_at=NOW(),
            submitted_on=$2,
            submission_method=COALESCE($3, submission_method),
            agency_reference=COALESCE($4, agency_reference),
            updated_at=NOW()
      WHERE id=$1 AND deleted_at IS NULL AND status IN ('draft','returned') RETURNING *`,
    [req.params['id'], b.submitted_on ?? today(), b.submission_method ?? null, b.agency_reference ?? null]);
  if (!r.rows[0]) throw conflict('Only invoices that are not submitted yet, or were returned, can be marked submitted');
  res.json({ data: r.rows[0] });
});
invoicesRouter.patch('/:id/submit', requireRole('owner','admin','project_manager','accountant'), validate(submitSchema), submitHandler);
invoicesRouter.patch('/:id/send', requireRole('owner','admin','project_manager','accountant'), validate(submitSchema), submitHandler);

/** The agency approved the invoice for payment. Funding opens up from here. */
invoicesRouter.patch('/:id/approve', requireRole('owner','admin','project_manager','accountant'), validate(approveSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof approveSchema>;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `UPDATE invoices SET status='approved', approved_on=$2, updated_at=NOW()
      WHERE id=$1 AND deleted_at IS NULL AND status IN ${AWAITING} RETURNING *`,
    [req.params['id'], b.approved_on ?? today()]);
  if (!r.rows[0]) throw conflict('Only invoices submitted to the agency can be marked approved');
  res.json({ data: r.rows[0] });
}));

/** The agency sent it back. The contractor fixes it and marks it submitted again. */
invoicesRouter.patch('/:id/return', requireRole('owner','admin','project_manager','accountant'), validate(returnSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof returnSchema>;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `UPDATE invoices SET status='returned', returned_on=$2, return_note=$3, updated_at=NOW()
      WHERE id=$1 AND deleted_at IS NULL AND status IN ${AWAITING} RETURNING *`,
    [req.params['id'], b.returned_on ?? today(), b.note || null]);
  if (!r.rows[0]) throw conflict('Only invoices submitted to the agency can be marked returned');
  res.json({ data: r.rows[0] });
}));

/** A payment received from the agency. One row per payment, so partials keep their own record. */
invoicesRouter.patch('/:id/record-payment', requireRole('owner','admin','accountant'), validate(paymentSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof paymentSchema>;
  const row = await withTransaction(req.auth.companyId, async (c) => {
    const cur = await c.query<{ status: string; balance_due: string }>(
      `SELECT status, balance_due FROM invoices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [req.params['id']]);
    const inv = cur.rows[0];
    if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
    if (['draft', 'returned', 'paid', 'void'].includes(inv.status)) {
      throw conflict('Payments can only be recorded on invoices submitted to the agency');
    }
    if (b.amount > Number(inv.balance_due) + 0.005) {
      throw Object.assign(new Error(`That is more than the balance due (${inv.balance_due})`), { status: 422 });
    }
    await c.query(
      `INSERT INTO invoice_payments (company_id, invoice_id, amount, paid_on, reference, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.auth.companyId, req.params['id'], b.amount.toFixed(2), b.paid_on ?? today(), b.reference || null, req.auth.userId]);
    const r = await c.query(
      `UPDATE invoices SET
         paid_amount = paid_amount + $2,
         balance_due = total - (paid_amount + $2),
         status = CASE WHEN (paid_amount + $2) >= total - 0.005 THEN 'paid'::invoice_status
                       ELSE 'partially_paid'::invoice_status END,
         updated_at = NOW()
       WHERE id=$1 RETURNING *`,
      [req.params['id'], b.amount.toFixed(2)]);
    return r.rows[0];
  });
  res.json({ data: row });
}));

invoicesRouter.patch('/:id/void', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const row = await withTransaction(req.auth.companyId, async (c) => {
    // A voided invoice with live funding against it would leave One Source
    // underwriting something the client has cancelled.
    const open = await c.query(
      `SELECT 1 FROM funding_requests WHERE invoice_id=$1 AND status IN ('submitted','under_review','approved')`,
      [req.params['id']]);
    if (open.rows[0]) throw conflict('This invoice has an open funding request. Withdraw the request before voiding it.');
    const r = await c.query(
      `UPDATE invoices SET status='void',updated_at=NOW()
        WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('paid','void') RETURNING *`, [req.params['id']]);
    if (!r.rows[0]) throw conflict('Invoice cannot be voided');
    return r.rows[0];
  });
  res.json({ data: row });
}));
