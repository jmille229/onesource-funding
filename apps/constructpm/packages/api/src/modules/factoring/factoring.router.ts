import { Router } from 'express';
import { z } from 'zod';
import { readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { notify, OPS_INBOX } from '../../lib/mailer.js';
import { asyncHandler, requireRole, validate } from '../../middleware/index.js';
import { exposureLimit, type UnderwritingPolicy } from './underwriting.js';
import { scoreRequestInBackground } from './underwriting.service.js';

export const factoringRouter = Router();

// Financial data: owners, admins and accountants only. Field crew and viewers
// have no business seeing the company's funding position.
const FINANCE_ROLES = ['owner', 'admin', 'accountant'] as const;

// Everything a client sees about an advance, derived rather than stored so the
// numbers are correct on the day they are read:
//
//   days_outstanding  since the money went out (frozen at collection)
//   days_to_recourse  how long until the advance can be charged back — the
//                     number a contractor actually worries about
//   accrued_fee       from the tiered schedule, via the SECURITY DEFINER
//                     function (tier tables are not readable by tenants)
//   net_expected      what lands when the debtor pays: reserve less fees
//
// The fee schedule itself is never exposed; the client sees the outcome, not the
// curve.
const INVOICE_SELECT = `
  SELECT fi.id,
         fi.invoice_number,
         fi.debtor_name,
         fi.face_amount,
         fi.advance_amount,
         fi.reserve_amount,
         fi.status,
         fi.advanced_on,
         fi.invoice_due_on,
         fi.collected_on,
         fi.job_id,
         fi.invoice_id,
         j.name        AS job_name,
         j.job_number  AS job_number,
         CASE WHEN fi.advanced_on IS NULL THEN NULL
              ELSE (COALESCE(fi.collected_on, CURRENT_DATE) - fi.advanced_on)
         END AS days_outstanding,
         CASE WHEN fi.advanced_on IS NULL OR fi.status <> 'advanced' THEN NULL
              ELSE (fi.advanced_on + fi.recourse_days) - CURRENT_DATE
         END AS days_to_recourse,
         COALESCE(factoring_accrued_fee(fi.id), 0) AS accrued_fee,
         GREATEST(fi.reserve_amount - COALESCE(factoring_accrued_fee(fi.id), 0), 0) AS net_expected
    FROM factored_invoices fi
    LEFT JOIN jobs j ON j.id = fi.job_id
`;

/** GET /api/factoring/summary — is factoring enabled, and the headline numbers. */
factoringRouter.get('/summary', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);

  const client = await db.query<{ status: string; credit_limit: string | null }>(
    `SELECT status, credit_limit FROM factoring_clients LIMIT 1`);

  if (!client.rows[0]) {
    // Not a factoring client — the UI hides the section entirely.
    res.json({ data: { enabled: false } });
    return;
  }

  const totals = await db.query<Record<string, string>>(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'advanced')                      AS outstanding_count,
      COALESCE(SUM(advance_amount) FILTER (WHERE status = 'advanced'), 0) AS advanced_outstanding,
      COALESCE(SUM(reserve_amount) FILTER (WHERE status IN ('advanced','collected')), 0) AS reserve_held,
      COALESCE(SUM(factoring_accrued_fee(id)) FILTER (WHERE status = 'advanced'), 0) AS fees_accrued,
      COALESCE(SUM(GREATEST(reserve_amount - COALESCE(factoring_accrued_fee(id),0),0))
               FILTER (WHERE status IN ('advanced','collected')), 0)   AS net_expected,
      COUNT(*) FILTER (
        WHERE status = 'advanced'
          AND (advanced_on + recourse_days) - CURRENT_DATE <= 14
      ) AS approaching_recourse
    FROM factored_invoices`);

  // The graduated funding limit, computed live from the tenant's own settled
  // history. The four policy numbers this needs are granted to the tenant role
  // on purpose (V006): showing a contractor that repaying on time raises their
  // ceiling is the mechanism that earns repeat funding. The scoring thresholds
  // stay hidden — the client sees the number, never the reasoning.
  const policy = await db.query<{ starting_limit: string; limit_step: string; max_limit: string; on_time_days: string }>(
    `SELECT starting_limit, limit_step, max_limit, on_time_days
       FROM underwriting_policy ORDER BY version DESC LIMIT 1`);

  let exposure: { limit: number; current: number; headroom: number } | null = null;
  if (policy.rows[0]) {
    const p = policy.rows[0];
    const settled = await db.query<{ on_time: string; late: string; open_exposure: string }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status IN ('collected','closed')
             AND COALESCE(collected_on, closed_on) - advanced_on <= $1) AS on_time,
         COUNT(*) FILTER (
           WHERE status IN ('collected','closed')
             AND COALESCE(collected_on, closed_on) - advanced_on > $1) AS late,
         COALESCE(SUM(advance_amount) FILTER (WHERE status IN ('pending','advanced')), 0) AS open_exposure
       FROM factored_invoices WHERE status <> 'charged_back'`, [Number(p.on_time_days)]);
    const s = settled.rows[0]!;
    const limit = exposureLimit({
      credit_limit_override: client.rows[0].credit_limit === null ? null : Number(client.rows[0].credit_limit),
      settled_on_time: Number(s.on_time),
      settled_late: Number(s.late),
    }, {
      starting_limit: Number(p.starting_limit),
      limit_step: Number(p.limit_step),
      max_limit: Number(p.max_limit),
    } as UnderwritingPolicy);
    const current = Number(s.open_exposure);
    exposure = { limit, current, headroom: Math.max(0, limit - current) };
  }

  res.json({
    data: {
      enabled: true,
      status: client.rows[0].status,
      credit_limit: client.rows[0].credit_limit,
      funding_limit: exposure?.limit ?? null,
      funding_used: exposure?.current ?? null,
      funding_available: exposure?.headroom ?? null,
      ...totals.rows[0],
    },
  });
}));

/** GET /api/factoring/invoices?status=outstanding|all */
factoringRouter.get('/invoices', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const { status } = req.query as Record<string, string>;
  const db = createRlsClient(readPool, req.auth.companyId);

  // Whitelisted, never interpolated from the query string.
  const filter = status === 'all'
    ? ''
    : status === 'closed'
      ? `WHERE fi.status IN ('collected','closed','charged_back')`
      : `WHERE fi.status IN ('pending','advanced')`;

  const r = await db.query(
    `${INVOICE_SELECT} ${filter} ORDER BY fi.advanced_on DESC NULLS FIRST, fi.created_at DESC LIMIT $1`,
    [parsePagination(req.query, { defaultPerPage: 500, maxPerPage: 1000 }).limit]);
  res.json({ data: r.rows });
}));

/** GET /api/factoring/invoices/:id — detail plus its event history. */
factoringRouter.get('/invoices/:id', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);

  const inv = await db.query(`${INVOICE_SELECT} WHERE fi.id = $1`, [req.params['id']]);
  if (!inv.rows[0]) {
    res.status(404).json({ error: 'not_found', message: 'Advance not found' });
    return;
  }

  const events = await db.query(
    `SELECT id, event_type, amount, occurred_on, memo
       FROM factoring_events
      WHERE factored_invoice_id = $1
      ORDER BY occurred_on DESC, created_at DESC`,
    [req.params['id']]);

  res.json({ data: { ...inv.rows[0], events: events.rows } });
}));

// ═══════════════════════════════════════════════════════════════════════════
// Requests
//
// The only factoring writes a client may make. They create a *request*; the
// funded book (factored_invoices) remains SELECT-only for tenants, and only
// OneSource converts a request into an advance.
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/factoring/requests — this company's funding requests. */
factoringRouter.get('/requests', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT fr.*, (SELECT COUNT(*) FROM file_attachments fa
                    WHERE fa.entity_type = 'funding_request' AND fa.entity_id = fr.id) AS document_count
       FROM funding_requests fr
      ORDER BY fr.requested_at DESC
      LIMIT $1`,
    [parsePagination(req.query, { defaultPerPage: 500, maxPerPage: 1000 }).limit]);
  res.json({ data: r.rows });
}));

/**
 * POST /api/factoring/requests — ask OneSource to fund an invoice.
 *
 * Requires at least one uploaded document: the client attaches a copy of the
 * invoice before requesting, and underwriting has nothing to work from without
 * it. Enforced here rather than only in the UI.
 */
factoringRouter.post(
  '/requests',
  requireRole(...FINANCE_ROLES),
  validate(z.object({ invoice_id: z.string().uuid(), note: z.string().max(2000).nullable().optional() })),
  asyncHandler(async (req, res) => {
    const { invoice_id, note } = req.body as { invoice_id: string; note?: string | null };

    const created = await withTransaction(req.auth.companyId, async (c) => {
      // Must be a factoring client. Non-clients get the onboarding flow instead.
      const client = await c.query(`SELECT id FROM factoring_clients WHERE status = 'active'`);
      if (!client.rows[0]) {
        throw Object.assign(new Error('This account is not set up for factoring yet'), { status: 409 });
      }

      // RLS scopes this to the caller's company, so an invoice id belonging to
      // another tenant simply isn't found.
      const inv = await c.query<{ id: string; invoice_number: string; total: string; customer_id: string }>(
        `SELECT id, invoice_number, total, customer_id FROM invoices
          WHERE id = $1 AND deleted_at IS NULL`, [invoice_id]);
      if (!inv.rows[0]) throw Object.assign(new Error('Invoice not found'), { status: 404 });

      // Check for an existing request before the document check. The partial
      // unique index would catch a duplicate anyway, but only after the document
      // rule had already failed with a misleading "attach a copy" message —
      // misleading because the copy is attached, just to the earlier request.
      const open = await c.query(
        `SELECT id FROM funding_requests
          WHERE invoice_id = $1 AND status IN ('submitted','under_review','approved')`, [invoice_id]);
      if (open.rows[0]) {
        throw Object.assign(
          new Error('A funding request is already open for this invoice'), { status: 409 });
      }

      const docs = await c.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM file_attachments
          WHERE entity_type = 'funding_request_draft' AND entity_id = $1`, [invoice_id]);
      if (Number(docs.rows[0]!.n) === 0) {
        throw Object.assign(
          new Error('Attach a copy of the invoice before requesting funding'), { status: 422 });
      }

      const customer = await c.query<{ name: string }>(
        `SELECT name FROM contacts WHERE id = $1`, [inv.rows[0].customer_id]);

      const r = await c.query(
        `INSERT INTO funding_requests
           (company_id, invoice_id, requested_amount, customer_name, invoice_number, note, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.auth.companyId, invoice_id, inv.rows[0].total,
         customer.rows[0]?.name ?? null, inv.rows[0].invoice_number, note ?? null, req.auth.userId]);

      // Move the draft attachments onto the request now that it exists.
      await c.query(
        `UPDATE file_attachments SET entity_type = 'funding_request', entity_id = $1
          WHERE entity_type = 'funding_request_draft' AND entity_id = $2`,
        [r.rows[0]!['id'], invoice_id]);

      return r.rows[0]!;
    }).catch((err: { code?: string; status?: number }) => {
      // Partial unique index on open requests per invoice.
      if (err.code === '23505') {
        throw Object.assign(new Error('A funding request is already open for this invoice'), { status: 409 });
      }
      throw err;
    });

    // Score it. Best-effort like the mail below: the request is committed, and
    // an unscored request just reaches the operator queue without a
    // recommendation rather than failing the client's submission.
    scoreRequestInBackground(created['id'] as string);

    // Best-effort; the request is already committed.
    void notify({
      to: OPS_INBOX,
      subject: `Funding requested — ${created['invoice_number']}`,
      text: `A client has requested funding.\n\n`
          + `Invoice: ${created['invoice_number']}\n`
          + `Amount:  ${created['requested_amount']}\n`
          + `Customer: ${created['customer_name'] ?? '—'}\n\n`
          + `Review it in the operator console.`,
    });

    res.status(201).json({ data: created });
  })
);

/** PATCH /api/factoring/requests/:id/withdraw — cancel a still-pending request. */
factoringRouter.patch('/requests/:id/withdraw', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  // The database permits tenants to update only the `status` column, and only
  // from 'submitted' to 'withdrawn' — see V005.
  const r = await withTransaction(req.auth.companyId, (c) =>
    c.query(`UPDATE funding_requests SET status = 'withdrawn'
              WHERE id = $1 AND status = 'submitted' RETURNING id, status`, [req.params['id']]));
  if (!r.rows[0]) {
    res.status(422).json({ error: 'invalid_state', message: 'Only a pending request can be withdrawn' });
    return;
  }
  res.json({ data: r.rows[0] });
}));

// ─── Onboarding (non-clients) ─────────────────────────────────────────────────
factoringRouter.get('/onboarding', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT id, status, created_at FROM factoring_onboarding_requests
      ORDER BY created_at DESC LIMIT 1`);
  res.json({ data: r.rows[0] ?? null });
}));

factoringRouter.post(
  '/onboarding',
  requireRole(...FINANCE_ROLES),
  validate(z.object({
    contact_name: z.string().min(1).max(120),
    contact_email: z.string().email().max(254),
    contact_phone: z.string().max(40).nullable().optional(),
    monthly_volume: z.number().nonnegative().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    invoice_id: z.string().uuid().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const created = await withTransaction(req.auth.companyId, (c) =>
      c.query(
        `INSERT INTO factoring_onboarding_requests
           (company_id, contact_name, contact_email, contact_phone, monthly_volume, note, invoice_id, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.auth.companyId, b['contact_name'], b['contact_email'], b['contact_phone'] ?? null,
         b['monthly_volume'] ?? null, b['note'] ?? null, b['invoice_id'] ?? null, req.auth.userId])
    ).catch((err: { code?: string }) => {
      if (err.code === '23505') {
        throw Object.assign(new Error('You already have an enquiry in progress'), { status: 409 });
      }
      throw err;
    });

    void notify({
      to: OPS_INBOX,
      subject: 'New factoring enquiry',
      text: `A ConstructPM company has asked about factoring.\n\n`
          + `Contact: ${b['contact_name']} <${b['contact_email']}>\n`
          + `Phone:   ${b['contact_phone'] ?? '—'}\n`
          + `Monthly volume: ${b['monthly_volume'] ?? '—'}\n\n`
          + `${b['note'] ?? ''}`,
    });

    res.status(201).json({ data: created.rows[0] });
  })
);
