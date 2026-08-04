import { Router } from 'express';
import { readPool, createRlsClient } from '../../lib/db.js';
import { asyncHandler, requireRole } from '../../middleware/index.js';

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

  res.json({
    data: {
      enabled: true,
      status: client.rows[0].status,
      credit_limit: client.rows[0].credit_limit,
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
    `${INVOICE_SELECT} ${filter} ORDER BY fi.advanced_on DESC NULLS FIRST, fi.created_at DESC`);
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
