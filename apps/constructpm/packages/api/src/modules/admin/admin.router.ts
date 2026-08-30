import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { adminPool, withAdminTransaction, audit } from '../../lib/admin-db.js';
import { signPlatformToken } from '../../lib/jwt.js';
import { buildUpdateSet } from '../../lib/sql.js';
import { isPlaceholderInvoiceNumber } from '../factoring/underwriting.js';
import { scoreRequest } from '../factoring/underwriting.service.js';
import { parseDelimited, toAdvancePayload } from './import-map.js';
import {
  asyncHandler, validate, authenticatePlatform, authRateLimit,
} from '../../middleware/index.js';

export const adminRouter = Router();

// Same parameters as tenant auth (see auth.router.ts) so operator credentials
// are no weaker than a contractor's.
const ARGON2_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
};

function pool() {
  if (!adminPool) throw Object.assign(new Error('admin not configured'), { status: 503 });
  return adminPool;
}

// ─── Operator login ───────────────────────────────────────────────────────────
// Rate limited by IP like tenant login. Same timing-safe shape: hash even on a
// miss so a missing account is indistinguishable from a wrong password.
adminRouter.post(
  '/auth/login',
  authRateLimit,
  validate(z.object({ email: z.string().email(), password: z.string().min(1).max(1024) })),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const r = await pool().query<{ id: string; email: string; password_hash: string; is_active: boolean }>(
      `SELECT id, email, password_hash, is_active FROM platform_users WHERE LOWER(email) = LOWER($1)`,
      [email]);
    const user = r.rows[0];

    let valid = false;
    if (user?.password_hash?.startsWith('$argon2')) {
      valid = await argon2.verify(user.password_hash, password, ARGON2_OPTS);
    } else {
      await argon2.hash(password, ARGON2_OPTS).catch(() => {});
    }

    if (!user || !valid || !user.is_active) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    await pool().query(`UPDATE platform_users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    res.json({
      data: {
        access_token: signPlatformToken({ userId: user.id, email: user.email }),
        token_type: 'Bearer',
        expires_in: 3600,
        user: { id: user.id, email: user.email },
      },
    });
  })
);

// Everything below requires an operator token.
adminRouter.use(authenticatePlatform);

adminRouter.get('/me', asyncHandler(async (req, res) => {
  res.json({ data: req.platform });
}));

// ─── Clients ──────────────────────────────────────────────────────────────────
adminRouter.get('/clients', asyncHandler(async (_req, res) => {
  const r = await pool().query(`
    SELECT fc.id, fc.company_id, fc.status, fc.credit_limit, fc.onboarded_on,
           fc.default_fee_schedule_id, c.name AS company_name,
           fc.tax_lien_personal, fc.tax_lien_business, fc.judgement, fc.lawsuit,
           fc.existing_ucc, fc.ucc_is_prior_factor, fc.personal_guarantee,
           fc.uses_subs, fc.does_progress_billing, fc.negative_list, fc.negative_list_reason,
           COALESCE(SUM(fi.advance_amount) FILTER (WHERE fi.status='advanced'),0) AS advanced_outstanding,
           COUNT(fi.id) FILTER (WHERE fi.status='advanced') AS outstanding_count,
           -- The two counts the graduated limit is built from, so the console can
           -- show why a client's ceiling is what it is.
           COUNT(fi.id) FILTER (
             WHERE fi.status IN ('collected','closed')
               AND COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on <= p.on_time_days) AS settled_on_time,
           COUNT(fi.id) FILTER (
             WHERE fi.status IN ('collected','closed')
               AND COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on > p.on_time_days) AS settled_late
      FROM factoring_clients fc
      JOIN companies c ON c.id = fc.company_id
      CROSS JOIN LATERAL (
        SELECT on_time_days FROM underwriting_policy ORDER BY version DESC LIMIT 1) p
      LEFT JOIN factored_invoices fi ON fi.factoring_client_id = fc.id
     GROUP BY fc.id, c.name, p.on_time_days
     ORDER BY c.name`);
  res.json({ data: r.rows });
}));

adminRouter.post(
  '/clients',
  validate(z.object({
    company_id: z.string().uuid(),
    status: z.enum(['prospect', 'active', 'suspended', 'closed']).default('prospect'),
    default_fee_schedule_id: z.string().uuid().nullable().optional(),
    credit_limit: z.number().nonnegative().nullable().optional(),
    onboarded_on: z.string().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `INSERT INTO factoring_clients (company_id,status,default_fee_schedule_id,credit_limit,onboarded_on)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (company_id) DO UPDATE SET
           status=EXCLUDED.status,
           default_fee_schedule_id=EXCLUDED.default_fee_schedule_id,
           credit_limit=EXCLUDED.credit_limit,
           onboarded_on=EXCLUDED.onboarded_on,
           updated_at=NOW()
         RETURNING *`,
        [b['company_id'], b['status'], b['default_fee_schedule_id'] ?? null,
         b['credit_limit'] ?? null, b['onboarded_on'] ?? null]);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'upsert', entityType: 'factoring_client',
        entityId: r.rows[0]!['id'], companyId: String(b['company_id']), after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.status(201).json({ data: row });
  })
);

// ─── Fee schedules ────────────────────────────────────────────────────────────
adminRouter.get('/fee-schedules', asyncHandler(async (_req, res) => {
  const r = await pool().query(`
    SELECT fs.*,
           COALESCE(json_agg(json_build_object('from_day',t.from_day,'to_day',t.to_day,'fee_pct',t.fee_pct)
                    ORDER BY t.from_day) FILTER (WHERE t.id IS NOT NULL), '[]') AS tiers
      FROM fee_schedules fs
      LEFT JOIN fee_schedule_tiers t ON t.fee_schedule_id = fs.id
     GROUP BY fs.id ORDER BY fs.name`);
  res.json({ data: r.rows });
}));

adminRouter.post(
  '/fee-schedules',
  validate(z.object({
    name: z.string().min(1).max(120),
    description: z.string().nullable().optional(),
    tier_mode: z.enum(['step', 'cumulative']).default('step'),
    advance_rate_pct: z.number().positive().max(100),
    recourse_days: z.number().int().positive(),
    is_template: z.boolean().default(true),
    tiers: z.array(z.object({
      from_day: z.number().int().nonnegative(),
      to_day: z.number().int().nonnegative().nullable(),
      fee_pct: z.number().nonnegative(),
    })).min(1),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const tiers = b['tiers'] as { from_day: number; to_day: number | null; fee_pct: number }[];
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `INSERT INTO fee_schedules (name,description,tier_mode,advance_rate_pct,recourse_days,is_template)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [b['name'], b['description'] ?? null, b['tier_mode'], b['advance_rate_pct'],
         b['recourse_days'], b['is_template']]);
      for (const t of tiers) {
        await c.query(
          `INSERT INTO fee_schedule_tiers (fee_schedule_id,from_day,to_day,fee_pct) VALUES ($1,$2,$3,$4)`,
          [r.rows[0]!['id'], t.from_day, t.to_day, t.fee_pct]);
      }
      await audit(c, {
        platformUserId: req.platform.userId, action: 'create', entityType: 'fee_schedule',
        entityId: r.rows[0]!['id'], after: { ...r.rows[0], tiers }, ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.status(201).json({ data: row });
  })
);

// ─── Debtors and concentration ────────────────────────────────────────────────
adminRouter.get('/debtors', asyncHandler(async (_req, res) => {
  const r = await pool().query(`
    SELECT d.id, d.legal_name, d.credit_limit, d.risk_grade,
           d.portal_visibility, d.invoice_confirmation, d.ach_change,
           d.staff_communication, d.verification_notes,
           COALESCE(SUM(fi.advance_amount) FILTER (WHERE fi.status='advanced'),0) AS exposure,
           COUNT(DISTINCT fi.company_id) FILTER (WHERE fi.status='advanced')      AS client_count,
           COUNT(fi.id) FILTER (WHERE fi.status='advanced')                       AS invoice_count,
           -- How this agency actually pays, which is what duration is priced on.
           COUNT(fi.id) FILTER (WHERE fi.status IN ('collected','closed'))         AS settled_count,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
             FILTER (WHERE fi.status IN ('collected','closed'))                    AS median_dso,
           -- How old the open book against this agency is right now. Read next to
           -- median_dso, this is the slowdown: an agency that normally settles in
           -- 32 days carrying 130-day-old paper is the signal worth acting on.
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE - fi.advanced_on)
             FILTER (WHERE fi.status IN ('pending','advanced') AND fi.advanced_on IS NOT NULL)
                                                                                   AS median_open_age,
           (
             COUNT(*) FILTER (WHERE fi.status IN ('pending','advanced')) >= 3
             AND COUNT(DISTINCT fi.company_id) FILTER (WHERE fi.status IN ('pending','advanced')) >= 2
             AND PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                   FILTER (WHERE fi.status IN ('collected','closed')) IS NOT NULL
             AND PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE - fi.advanced_on)
                   FILTER (WHERE fi.status IN ('pending','advanced') AND fi.advanced_on IS NOT NULL)
                 > GREATEST(
                     PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                       FILTER (WHERE fi.status IN ('collected','closed')) * 1.5,
                     PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                       FILTER (WHERE fi.status IN ('collected','closed')) + 15)
           )                                                                       AS in_slowdown
      FROM factoring_debtors d
      LEFT JOIN factored_invoices fi ON fi.debtor_id = d.id
     GROUP BY d.id ORDER BY exposure DESC`);
  res.json({ data: r.rows });
}));

adminRouter.post(
  '/debtors',
  validate(z.object({
    legal_name: z.string().min(1).max(200),
    dba: z.string().nullable().optional(),
    credit_limit: z.number().nonnegative().nullable().optional(),
    risk_grade: z.string().max(20).nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `INSERT INTO factoring_debtors (legal_name,dba,credit_limit,risk_grade)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [b['legal_name'], b['dba'] ?? null, b['credit_limit'] ?? null, b['risk_grade'] ?? null]);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'create', entityType: 'factoring_debtor',
        entityId: r.rows[0]!['id'], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.status(201).json({ data: row });
  })
);

// ─── Advances ─────────────────────────────────────────────────────────────────
adminRouter.get('/invoices', asyncHandler(async (req, res) => {
  const { company_id, status } = req.query as Record<string, string>;
  const params: unknown[] = [];
  const conds: string[] = [];
  if (company_id) { params.push(company_id); conds.push(`fi.company_id = $${params.length}`); }
  if (status)     { params.push(status);     conds.push(`fi.status = $${params.length}::factored_invoice_status`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await pool().query(`
    SELECT fi.*, c.name AS company_name,
           (COALESCE(fi.collected_on, CURRENT_DATE) - fi.advanced_on) AS days_outstanding,
           COALESCE(factoring_accrued_fee(fi.id),0) AS accrued_fee
      FROM factored_invoices fi
      JOIN companies c ON c.id = fi.company_id
      ${where}
     ORDER BY fi.advanced_on DESC NULLS FIRST`, params);
  res.json({ data: r.rows });
}));

const fundSchema = z.object({
  company_id: z.string().uuid(),
  debtor_id: z.string().uuid(),
  // Optional. When absent the factored_invoices UUID id identifies the row
  // in every UI and receipt (see shared.factoredInvoiceRef). A supplied
  // placeholder like "-" or "N/A" is still refused by the underwriting engine
  // — the two cases are treated differently on purpose.
  invoice_number: z.string().trim().max(60).nullable().optional(),
  face_amount: z.number().positive(),
  advanced_on: z.string(),
  invoice_due_on: z.string().nullable().optional(),
  // Optional override; otherwise the client's default schedule applies.
  fee_schedule_id: z.string().uuid().nullable().optional(),
  invoice_id: z.string().uuid().nullable().optional(),
  job_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Funds an invoice. The advance/reserve split is computed from the schedule's
 * advance rate rather than accepted from the caller, and the rate and recourse
 * period are snapshotted onto the row — editing a schedule later must not
 * rewrite the economics of money already advanced.
 */
async function fundInvoice(
  c: import('pg').PoolClient,
  b: z.infer<typeof fundSchema>,
  platformUserId: string,
  ip: string | null
) {
  const client = await c.query<{ id: string; default_fee_schedule_id: string | null }>(
    `SELECT id, default_fee_schedule_id FROM factoring_clients WHERE company_id = $1`,
    [b.company_id]);
  if (!client.rows[0]) {
    throw Object.assign(new Error('company is not a factoring client'), { status: 422 });
  }

  const scheduleId = b.fee_schedule_id ?? client.rows[0].default_fee_schedule_id;
  if (!scheduleId) {
    throw Object.assign(new Error('no fee schedule for this client'), { status: 422 });
  }

  const sched = await c.query<{ advance_rate_pct: string; recourse_days: number; retired_at: string | null }>(
    `SELECT advance_rate_pct, recourse_days, retired_at FROM fee_schedules WHERE id = $1`, [scheduleId]);
  if (!sched.rows[0]) throw Object.assign(new Error('fee schedule not found'), { status: 422 });
  if (sched.rows[0].retired_at) {
    throw Object.assign(new Error('fee schedule is retired'), { status: 422 });
  }

  const debtor = await c.query<{ legal_name: string }>(
    `SELECT legal_name FROM factoring_debtors WHERE id = $1`, [b.debtor_id]);
  if (!debtor.rows[0]) throw Object.assign(new Error('debtor not found'), { status: 422 });

  const rate = Number(sched.rows[0].advance_rate_pct);
  const advance = Math.round(b.face_amount * rate) / 100;
  const reserve = Math.round((b.face_amount - advance) * 100) / 100;

  const r = await c.query(
    `INSERT INTO factored_invoices
       (company_id,factoring_client_id,debtor_id,debtor_name,invoice_id,job_id,invoice_number,
        face_amount,fee_schedule_id,advance_rate_pct,recourse_days,advance_amount,reserve_amount,
        status,advanced_on,invoice_due_on,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'advanced',$14,$15,$16)
     RETURNING *`,
    [b.company_id, client.rows[0].id, b.debtor_id, debtor.rows[0].legal_name,
     b.invoice_id ?? null, b.job_id ?? null, b.invoice_number ?? null, b.face_amount, scheduleId,
     rate, sched.rows[0].recourse_days, advance, reserve, b.advanced_on, b.invoice_due_on ?? null,
     b.notes ?? null]);

  await c.query(
    `INSERT INTO factoring_events (company_id,factored_invoice_id,event_type,amount,occurred_on,memo)
     VALUES ($1,$2,'advance',$3,$4,'Advance funded')`,
    [b.company_id, r.rows[0]!['id'], advance, b.advanced_on]);

  await audit(c, {
    platformUserId, action: 'fund', entityType: 'factored_invoice',
    entityId: r.rows[0]!['id'], companyId: b.company_id, after: r.rows[0], ip,
  });

  return r.rows[0];
}

adminRouter.post('/invoices', validate(fundSchema), asyncHandler(async (req, res) => {
  const row = await withAdminTransaction((c) =>
    fundInvoice(c, req.body as z.infer<typeof fundSchema>, req.platform.userId, req.ip ?? null));
  res.status(201).json({ data: row });
}));

/** Records a debtor payment and moves the advance to collected. */
adminRouter.post(
  '/invoices/:id/collect',
  validate(z.object({
    collected_on: z.string(),
    amount: z.number().positive().nullable().optional(),
    memo: z.string().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const row = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM factored_invoices WHERE id=$1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('not found'), { status: 404 });

      const r = await c.query(
        `UPDATE factored_invoices
            SET status='collected', collected_on=$2, updated_at=NOW()
          WHERE id=$1 AND status='advanced' RETURNING *`,
        [req.params['id'], b['collected_on']]);
      if (!r.rows[0]) throw Object.assign(new Error('advance is not outstanding'), { status: 422 });

      await c.query(
        `INSERT INTO factoring_events (company_id,factored_invoice_id,event_type,amount,occurred_on,memo)
         VALUES ($1,$2,'payment_received',$3,$4,$5)`,
        [r.rows[0]['company_id'], r.rows[0]['id'],
         b['amount'] ?? r.rows[0]['face_amount'], b['collected_on'], b['memo'] ?? null]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'collect', entityType: 'factored_invoice',
        entityId: String(req.params['id']), companyId: String(r.rows[0]['company_id']),
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: row });
  })
);

/** Releases the reserve (less fees) and closes the advance. */
adminRouter.post(
  '/invoices/:id/close',
  validate(z.object({ closed_on: z.string(), memo: z.string().nullable().optional() })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const row = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM factored_invoices WHERE id=$1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('not found'), { status: 404 });

      const fee = await c.query<{ fee: string }>(
        `SELECT COALESCE(factoring_accrued_fee($1),0) AS fee`, [req.params['id']]);
      const net = Math.max(Number(before.rows[0]['reserve_amount']) - Number(fee.rows[0]!.fee), 0);

      const r = await c.query(
        `UPDATE factored_invoices SET status='closed', closed_on=$2, updated_at=NOW()
          WHERE id=$1 AND status='collected' RETURNING *`,
        [req.params['id'], b['closed_on']]);
      if (!r.rows[0]) throw Object.assign(new Error('advance is not collected'), { status: 422 });

      await c.query(
        `INSERT INTO factoring_events (company_id,factored_invoice_id,event_type,amount,occurred_on,memo)
         VALUES ($1,$2,'reserve_release',$3,$4,$5)`,
        [r.rows[0]['company_id'], r.rows[0]['id'], net, b['closed_on'],
         b['memo'] ?? `Reserve released net of ${fee.rows[0]!.fee} fees`]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'close', entityType: 'factored_invoice',
        entityId: String(req.params['id']), companyId: String(r.rows[0]['company_id']),
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: row });
  })
);

// ─── CSV import ───────────────────────────────────────────────────────────────
// The importer speaks the OneSource workbook's Advance Book columns directly,
// so the sheet the operator already maintains can be pasted in unchanged. The
// column-to-payload mapping and every parser live in ./import-map, tested in
// isolation there; this handler is the transactional shell around it.
//
// Nothing is written unless every row parses. Importing financial data blind is
// how you end up reconciling a half-applied batch by hand.

// Row splitting lives in ./import-map (parseDelimited) alongside the field
// parsers so it can be tested in isolation.

/**
 * Resolves a friendly Borrower name to a factoring_client, and a Creditor name
 * to a factoring_debtor. Both are cached across a batch — a workbook of 300
 * rows typically references a dozen names and lookups shouldn't cost 300 round
 * trips. Match is case- and whitespace-insensitive; a Borrower with no matching
 * factoring_client fails the row rather than silently creating one, because
 * the operator sets up clients deliberately (fee schedule, credit limit, etc).
 *
 * A Creditor with no debtor row IS created — that's a bookkeeping detail rather
 * than a policy decision, and forcing the operator to pre-seed debtors before
 * every import would be busywork.
 */
class NameResolver {
  private clients = new Map<string, { id: string; company_id: string }>();
  private debtors = new Map<string, string>();
  constructor(private c: import('pg').PoolClient) {}
  private static key(s: string) { return s.trim().toLowerCase().replace(/\s+/g, ' '); }

  async client(name: string): Promise<{ id: string; company_id: string }> {
    const k = NameResolver.key(name);
    const hit = this.clients.get(k);
    if (hit) return hit;
    const r = await this.c.query<{ id: string; company_id: string }>(
      `SELECT fc.id, fc.company_id
         FROM factoring_clients fc JOIN companies co ON co.id = fc.company_id
        WHERE LOWER(BTRIM(co.name)) = $1`, [k]);
    if (!r.rows[0]) throw new Error(`Borrower: "${name}" is not a set-up factoring client`);
    this.clients.set(k, r.rows[0]);
    return r.rows[0];
  }

  async debtor(name: string): Promise<string> {
    const k = NameResolver.key(name);
    const hit = this.debtors.get(k);
    if (hit) return hit;
    const found = await this.c.query<{ id: string }>(
      `SELECT id FROM factoring_debtors
        WHERE LOWER(BTRIM(legal_name)) = $1 OR LOWER(BTRIM(COALESCE(dba,''))) = $1
        LIMIT 1`, [k]);
    if (found.rows[0]) { this.debtors.set(k, found.rows[0].id); return found.rows[0].id; }
    // Create with the operator's spelling and mark it verification-unknown, so
    // the underwriting engine treats it as unproven until someone fills in the
    // agency's portal/confirmation/ACH/staff attributes.
    const made = await this.c.query<{ id: string }>(
      `INSERT INTO factoring_debtors (legal_name) VALUES ($1) RETURNING id`, [name.trim()]);
    this.debtors.set(k, made.rows[0]!.id);
    return made.rows[0]!.id;
  }
}

interface ParsedRow { row: number; payload: import('./import-map.js').AdvanceRowPayload; }

adminRouter.post(
  '/invoices/import',
  validate(z.object({ csv: z.string().min(1).max(2_000_000), dry_run: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const { csv, dry_run } = req.body as { csv: string; dry_run: boolean };
    const raw = parseDelimited(csv);

    const errors: { row: number; message: string }[] = [];
    const valid: ParsedRow[] = [];

    raw.forEach((r, i) => {
      // +2: 1-indexed, plus the header line.
      const rowNum = i + 2;
      // Skip rows that are entirely blank — operator sheets often carry
      // trailing empty rows and yelling about them adds noise, not signal.
      if (!Object.values(r).some((v) => v.trim() !== '')) return;
      try {
        valid.push({ row: rowNum, payload: toAdvancePayload(r) });
      } catch (err) {
        errors.push({ row: rowNum, message: (err as Error).message });
      }
    });

    if (dry_run || errors.length) {
      res.json({
        data: {
          dry_run: true,
          applied: 0,
          would_apply: valid.length,
          errors,
          preview: valid.slice(0, 20).map((v) => ({
            row: v.row,
            borrower: v.payload.borrower,
            creditor: v.payload.creditor,
            invoice_number: v.payload.invoice_number,
            face_amount: v.payload.face_amount,
            advanced_on: v.payload.advanced_on,
            will_settle: v.payload.collection !== null,
          })),
        },
      });
      return;
    }

    // One transaction, one resolver — either the whole batch lands or none does.
    const applied = await withAdminTransaction(async (c) => {
      const resolver = new NameResolver(c);
      let n = 0;
      for (const { row, payload } of valid) {
        try {
          const { company_id } = await resolver.client(payload.borrower);
          const debtor_id = await resolver.debtor(payload.creditor);

          const funded = await fundInvoice(c, {
            company_id, debtor_id,
            invoice_number: payload.invoice_number,
            face_amount: payload.face_amount,
            advanced_on: payload.advanced_on,
            invoice_due_on: null,
            fee_schedule_id: null,          // let the client's default_fee_schedule apply
            invoice_id: null, job_id: null,
            notes: payload.notes,
          }, req.platform.userId, req.ip ?? null);

          // Chain the collection when the workbook says the money came back.
          if (payload.collection) {
            const memo = payload.collection.check_number
              ? `Check #${payload.collection.check_number}`
              : null;
            await c.query(
              `UPDATE factored_invoices SET status='collected', collected_on=$2, updated_at=NOW()
                WHERE id=$1 AND status='advanced'`,
              [funded!['id'], payload.collection.collected_on]);
            await c.query(
              `INSERT INTO factoring_events (company_id,factored_invoice_id,event_type,amount,occurred_on,memo)
               VALUES ($1,$2,'payment_received',$3,$4,$5)`,
              [company_id, funded!['id'], payload.collection.amount_received,
               payload.collection.collected_on, memo]);
          }
          n++;
        } catch (err) {
          // A failure inside the transaction has to abort the whole batch, so
          // the operator sees which row broke rather than a partial application.
          throw Object.assign(new Error(`Row ${row}: ${(err as Error).message}`),
            { status: 422 });
        }
      }
      return n;
    });

    res.status(201).json({ data: { dry_run: false, applied, errors: [] } });
  })
);

// ─── Audit trail ──────────────────────────────────────────────────────────────
adminRouter.get('/audit', asyncHandler(async (_req, res) => {
  const r = await pool().query(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.company_id, a.occurred_at,
           p.email AS actor
      FROM factoring_audit_log a
      LEFT JOIN platform_users p ON p.id = a.platform_user_id
     ORDER BY a.occurred_at DESC LIMIT 200`);
  res.json({ data: r.rows });
}));

// ─── Requests ─────────────────────────────────────────────────────────────────
/** Pending counts, for the console badge. */
adminRouter.get('/requests/counts', asyncHandler(async (_req, res) => {
  const r = await pool().query<{ funding: string; onboarding: string }>(`
    SELECT (SELECT COUNT(*) FROM funding_requests WHERE status IN ('submitted','under_review')) AS funding,
           (SELECT COUNT(*) FROM factoring_onboarding_requests WHERE status IN ('submitted','contacted')) AS onboarding`);
  res.json({ data: r.rows[0] });
}));

adminRouter.get('/requests', asyncHandler(async (_req, res) => {
  // Each request carries its latest underwriting decision so the queue can be
  // triaged without opening every row — the whole point of scoring at intake.
  const r = await pool().query(`
    SELECT fr.*, c.name AS company_name,
           (SELECT COUNT(*) FROM file_attachments fa
             WHERE fa.entity_type = 'funding_request' AND fa.entity_id = fr.id) AS document_count,
           d.score        AS uw_score,
           d.action       AS uw_action,
           d.auto_applied AS uw_auto_applied,
           d.override_action AS uw_override_action,
           jsonb_array_length(d.hard_stops) AS uw_hard_stop_count,
           jsonb_array_length(d.referrals)  AS uw_referral_count,
           d.exposure_limit, d.exposure_current, d.exposure_headroom,
           d.recommended_advance_rate_pct
      FROM funding_requests fr
      JOIN companies c ON c.id = fr.company_id
      LEFT JOIN LATERAL (
        SELECT * FROM underwriting_decisions ud
         WHERE ud.funding_request_id = fr.id
         ORDER BY ud.created_at DESC LIMIT 1
      ) d ON TRUE
     ORDER BY CASE WHEN fr.status IN ('submitted','under_review') THEN 0 ELSE 1 END,
              fr.requested_at DESC`);
  res.json({ data: r.rows });
}));

// ─── Underwriting ─────────────────────────────────────────────────────────────

/** The full decision: every hard stop, every scored factor, and the inputs behind them. */
adminRouter.get('/requests/:id/decision', asyncHandler(async (req, res) => {
  const r = await pool().query(
    `SELECT d.*, p.email AS overridden_by_email
       FROM underwriting_decisions d
       LEFT JOIN platform_users p ON p.id = d.overridden_by
      WHERE d.funding_request_id = $1
      ORDER BY d.created_at DESC LIMIT 1`, [req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'No decision recorded yet' }); return; }
  res.json({ data: r.rows[0] });
}));

/**
 * Re-run the engine.
 *
 * Scoring is a snapshot, so a request scored before an agency's verification
 * attributes were filled in keeps the old numbers until someone asks for a
 * fresh look. Each run appends a new decision rather than replacing the last —
 * the history of what was known when is part of the audit trail.
 */
adminRouter.post('/requests/:id/rescore', asyncHandler(async (req, res) => {
  const decision = await scoreRequest(String(req.params['id']));
  if (!decision) { res.status(404).json({ error: 'not_found', message: 'Request not found' }); return; }
  await withAdminTransaction((c) => audit(c, {
    platformUserId: req.platform.userId, action: 'rescore_request',
    entityType: 'funding_request', entityId: String(req.params['id']),
    after: { score: decision.score, action: decision.action }, ip: req.ip ?? null,
  }));
  res.json({ data: decision });
}));

/**
 * Record a departure from the engine.
 *
 * The database requires an author, an action and a non-empty reason together
 * (uw_override_ck). Overrides are the training data for the next policy
 * version — an override with no stated reason teaches nothing, and a model
 * nobody explains their disagreement with stops being trusted.
 */
adminRouter.post(
  '/requests/:id/override',
  validate(z.object({
    action: z.enum(['approve', 'refer', 'decline']),
    reason: z.string().trim().min(10, 'Give a reason of at least 10 characters'),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as { action: string; reason: string };
    const out = await withAdminTransaction(async (c) => {
      const d = await c.query(
        `SELECT * FROM underwriting_decisions
          WHERE funding_request_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [req.params['id']]);
      if (!d.rows[0]) throw Object.assign(new Error('no decision to override'), { status: 404 });

      const updated = await c.query(
        `UPDATE underwriting_decisions
            SET override_action = $2, override_reason = $3,
                overridden_by = $4, overridden_at = NOW()
          WHERE id = $1 RETURNING *`,
        [d.rows[0]['id'], b.action, b.reason, req.platform.userId]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'override_decision',
        entityType: 'funding_request', entityId: String(req.params['id']),
        companyId: d.rows[0]['company_id'],
        before: { action: d.rows[0]['action'], score: d.rows[0]['score'] },
        after: { action: b.action, reason: b.reason }, ip: req.ip ?? null,
      });
      return updated.rows[0];
    });
    res.json({ data: out });
  })
);

/**
 * Key in a request that arrived by email or text.
 *
 * Clients still send invoices outside the app, and those need to reach the same
 * engine as in-app requests rather than being decided by eye off-system. The
 * request is created with source='operator' and no ConstructPM invoice behind
 * it, then scored identically.
 */
adminRouter.post(
  '/requests',
  validate(z.object({
    company_id: z.string().uuid(),
    debtor_id: z.string().uuid().nullable().optional(),
    // Optional. Blank means "not entered yet" — the funding_requests UUID id
    // identifies the row. A placeholder like "-" or "N/A" is still refused.
    invoice_number: z.string().trim().max(60).nullable().optional(),
    requested_amount: z.number().positive(),
    customer_name: z.string().trim().min(1).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;

    // Only guard against placeholders that are actively lying. A blank field
    // is now allowed and passes through as NULL — the engine treats blank as
    // "not entered yet" rather than as a made-up value.
    const rawInv = b['invoice_number'];
    const inv = typeof rawInv === 'string' ? rawInv.trim() : '';
    if (inv !== '' && isPlaceholderInvoiceNumber(inv)) {
      res.status(422).json({
        error: 'invalid_invoice_number',
        message: 'A placeholder like "-" or "N/A" is not a real invoice number. Leave it blank if the agency has not issued one yet.',
      });
      return;
    }

    const created = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `INSERT INTO funding_requests
           (company_id, invoice_id, debtor_id, requested_amount, customer_name,
            invoice_number, note, source, entered_by)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 'operator', $7)
         RETURNING *`,
        [b['company_id'], b['debtor_id'] ?? null, b['requested_amount'],
         b['customer_name'] ?? null, inv === '' ? null : inv,
         b['note'] ?? null, req.platform.userId]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'create_request',
        entityType: 'funding_request', entityId: r.rows[0]!['id'] as string,
        companyId: String(b['company_id']), after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0]!;
    });

    const decision = await scoreRequest(created['id'] as string);
    res.status(201).json({ data: { request: created, decision } });
  })
);

/** Agency verification attributes — the strongest predictor in the historical book. */
adminRouter.patch(
  '/debtors/:id',
  validate(z.object({
    portal_visibility: z.boolean().optional(),
    invoice_confirmation: z.enum(['none', 'confirmed', 'purchase_order']).optional(),
    ach_change: z.boolean().optional(),
    staff_communication: z.boolean().optional(),
    verification_notes: z.string().max(2000).nullable().optional(),
    credit_limit: z.number().nonnegative().nullable().optional(),
    risk_grade: z.string().max(16).nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const allowed = ['portal_visibility', 'invoice_confirmation', 'ach_change',
                     'staff_communication', 'verification_notes', 'credit_limit', 'risk_grade'];
    const set = buildUpdateSet(req.body as Record<string, unknown>, allowed);
    if (!set.clause) { res.status(400).json({ error: 'no_fields', message: 'Nothing to update' }); return; }

    const out = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM factoring_debtors WHERE id = $1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('debtor not found'), { status: 404 });
      const r = await c.query(
        `UPDATE factoring_debtors SET ${set.clause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params['id'], ...set.values]);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'update_debtor',
        entityType: 'factoring_debtor', entityId: String(req.params['id']),
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: out });
  })
);

/** Client screening attributes, including the two questions asked at onboarding. */
adminRouter.patch(
  '/clients/:id/underwriting',
  validate(z.object({
    tax_lien_personal: z.enum(['unknown', 'clean', 'present']).optional(),
    tax_lien_business: z.enum(['unknown', 'clean', 'present']).optional(),
    judgement: z.enum(['unknown', 'clean', 'present']).optional(),
    lawsuit: z.enum(['unknown', 'clean', 'present']).optional(),
    existing_ucc: z.enum(['unknown', 'clean', 'present']).optional(),
    ucc_is_prior_factor: z.boolean().optional(),
    personal_guarantee: z.boolean().optional(),
    uses_subs: z.boolean().nullable().optional(),
    does_progress_billing: z.boolean().nullable().optional(),
    negative_list: z.boolean().optional(),
    negative_list_reason: z.string().max(1000).nullable().optional(),
    credit_limit: z.number().nonnegative().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const allowed = ['tax_lien_personal', 'tax_lien_business', 'judgement', 'lawsuit',
                     'existing_ucc', 'ucc_is_prior_factor', 'personal_guarantee', 'uses_subs',
                     'does_progress_billing', 'negative_list', 'negative_list_reason', 'credit_limit'];
    const set = buildUpdateSet(req.body as Record<string, unknown>, allowed);
    if (!set.clause) { res.status(400).json({ error: 'no_fields', message: 'Nothing to update' }); return; }

    const out = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM factoring_clients WHERE id = $1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('client not found'), { status: 404 });
      const r = await c.query(
        `UPDATE factoring_clients SET ${set.clause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params['id'], ...set.values]);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'update_client_underwriting',
        entityType: 'factoring_client', entityId: String(req.params['id']),
        companyId: before.rows[0]['company_id'] as string,
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: out });
  })
);

/** The policy in force. */
adminRouter.get('/policy', asyncHandler(async (_req, res) => {
  const r = await pool().query(`SELECT * FROM underwriting_policy ORDER BY version DESC LIMIT 1`);
  res.json({ data: r.rows[0] ?? null });
}));

/**
 * Publish a new policy version.
 *
 * Append-only: superseding a policy inserts a successor rather than editing the
 * row in place, so a decision made last month can always be re-explained against
 * the thresholds that were actually in force when it was made.
 */
adminRouter.post(
  '/policy',
  validate(z.object({
    auto_approve_enabled: z.boolean().optional(),
    auto_approve_ceiling: z.number().positive().optional(),
    clean_score: z.number().int().min(0).max(100).optional(),
    decline_score: z.number().int().min(0).max(100).optional(),
    starting_limit: z.number().nonnegative().optional(),
    limit_step: z.number().nonnegative().optional(),
    max_limit: z.number().positive().optional(),
    on_time_days: z.number().int().positive().optional(),
    impairment_days: z.number().int().positive().optional(),
    default_advance_rate_pct: z.number().positive().max(100).optional(),
    min_advance_rate_pct: z.number().positive().max(100).optional(),
    max_advance_rate_pct: z.number().positive().max(100).optional(),
    large_invoice_threshold: z.number().positive().optional(),
    step_up_multiple: z.number().positive().optional(),
    debtor_concentration_pct: z.number().positive().max(100).optional(),
    notes: z.string().max(2000).optional(),
  }).refine(
    (v) => v.clean_score === undefined || v.decline_score === undefined || v.clean_score > v.decline_score,
    { message: 'clean_score must be above decline_score' },
  )),
  asyncHandler(async (req, res) => {
    const out = await withAdminTransaction(async (c) => {
      const cur = await c.query(`SELECT * FROM underwriting_policy ORDER BY version DESC LIMIT 1`);
      const base = cur.rows[0];
      if (!base) throw Object.assign(new Error('no policy to supersede'), { status: 500 });

      const next = { ...base, ...(req.body as Record<string, unknown>) };
      const version = Number(base['version']) + 1;
      const r = await c.query(
        `INSERT INTO underwriting_policy
           (version, auto_approve_enabled, auto_approve_ceiling, clean_score, decline_score,
            starting_limit, limit_step, max_limit, on_time_days, impairment_days,
            default_advance_rate_pct, min_advance_rate_pct, max_advance_rate_pct,
            large_invoice_threshold, step_up_multiple, debtor_concentration_pct, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [version, next['auto_approve_enabled'], next['auto_approve_ceiling'], next['clean_score'],
         next['decline_score'], next['starting_limit'], next['limit_step'], next['max_limit'],
         next['on_time_days'], next['impairment_days'], next['default_advance_rate_pct'],
         next['min_advance_rate_pct'], next['max_advance_rate_pct'], next['large_invoice_threshold'],
         next['step_up_multiple'], next['debtor_concentration_pct'], next['notes'] ?? null]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'publish_policy',
        entityType: 'underwriting_policy', entityId: String(version),
        before: base, after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.status(201).json({ data: out });
  })
);

adminRouter.get('/onboarding-requests', asyncHandler(async (_req, res) => {
  const r = await pool().query(`
    SELECT o.*, c.name AS company_name
      FROM factoring_onboarding_requests o
      JOIN companies c ON c.id = o.company_id
     ORDER BY CASE WHEN o.status IN ('submitted','contacted') THEN 0 ELSE 1 END, o.created_at DESC`);
  res.json({ data: r.rows });
}));

/**
 * Approve a request by funding it. Terms are chosen here — the debtor in
 * particular, because the client's "customer" is a tenant-scoped contact while
 * exposure is tracked against a platform-level debtor, and only an operator can
 * make that mapping.
 */
adminRouter.post(
  '/requests/:id/approve',
  validate(z.object({
    debtor_id: z.string().uuid(),
    advanced_on: z.string(),
    invoice_due_on: z.string().nullable().optional(),
    fee_schedule_id: z.string().uuid().nullable().optional(),
    face_amount: z.number().positive().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const out = await withAdminTransaction(async (c) => {
      const fr = await c.query<Record<string, string>>(
        `SELECT * FROM funding_requests WHERE id = $1 FOR UPDATE`, [req.params['id']]);
      if (!fr.rows[0]) throw Object.assign(new Error('request not found'), { status: 404 });
      if (!['submitted', 'under_review'].includes(fr.rows[0]['status']!)) {
        throw Object.assign(new Error('request is not pending'), { status: 422 });
      }

      const funded = await fundInvoice(c, {
        company_id: fr.rows[0]['company_id']!,
        debtor_id: String(b['debtor_id']),
        // Blank on the request stays blank on the invoice — the UUID id is
        // its identifier via factoredInvoiceRef.
        invoice_number: fr.rows[0]['invoice_number'] ?? null,
        face_amount: Number(b['face_amount'] ?? fr.rows[0]['requested_amount']),
        advanced_on: String(b['advanced_on']),
        invoice_due_on: (b['invoice_due_on'] as string | null) ?? null,
        fee_schedule_id: (b['fee_schedule_id'] as string | null) ?? null,
        invoice_id: fr.rows[0]['invoice_id'] ?? null,
        job_id: null,
        notes: `Funded from request ${req.params['id']}`,
      }, req.platform.userId, req.ip ?? null);

      const updated = await c.query(
        `UPDATE funding_requests
            SET status = 'approved', reviewed_at = NOW(), factored_invoice_id = $2, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [req.params['id'], funded!['id']]);

      await audit(c, {
        platformUserId: req.platform.userId, action: 'approve_request',
        entityType: 'funding_request', entityId: String(req.params['id']),
        companyId: fr.rows[0]['company_id'], before: fr.rows[0], after: updated.rows[0],
        ip: req.ip ?? null,
      });
      return { request: updated.rows[0], advance: funded };
    });
    res.json({ data: out });
  })
);

adminRouter.post(
  '/requests/:id/decline',
  validate(z.object({ reason: z.string().min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const reason = (req.body as { reason: string }).reason;
    const row = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM funding_requests WHERE id=$1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('not found'), { status: 404 });
      const r = await c.query(
        `UPDATE funding_requests
            SET status='declined', decline_reason=$2, reviewed_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND status IN ('submitted','under_review') RETURNING *`,
        [req.params['id'], reason]);
      if (!r.rows[0]) throw Object.assign(new Error('request is not pending'), { status: 422 });
      await audit(c, {
        platformUserId: req.platform.userId, action: 'decline_request',
        entityType: 'funding_request', entityId: String(req.params['id']),
        companyId: String(before.rows[0]['company_id']), before: before.rows[0], after: r.rows[0],
        ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: row });
  })
);
