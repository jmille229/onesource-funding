import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { adminPool, withAdminTransaction, audit } from '../../lib/admin-db.js';
import { signPlatformToken } from '../../lib/jwt.js';
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
           COALESCE(SUM(fi.advance_amount) FILTER (WHERE fi.status='advanced'),0) AS advanced_outstanding,
           COUNT(fi.id) FILTER (WHERE fi.status='advanced') AS outstanding_count
      FROM factoring_clients fc
      JOIN companies c ON c.id = fc.company_id
      LEFT JOIN factored_invoices fi ON fi.factoring_client_id = fc.id
     GROUP BY fc.id, c.name
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
           COALESCE(SUM(fi.advance_amount) FILTER (WHERE fi.status='advanced'),0) AS exposure,
           COUNT(DISTINCT fi.company_id) FILTER (WHERE fi.status='advanced')      AS client_count,
           COUNT(fi.id) FILTER (WHERE fi.status='advanced')                       AS invoice_count
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
  invoice_number: z.string().min(1).max(60),
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
     b.invoice_id ?? null, b.job_id ?? null, b.invoice_number, b.face_amount, scheduleId,
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
// Always parsed and validated in full before anything is written, and `dry_run`
// is the default. Importing financial data blind is how you end up reconciling a
// half-applied batch by hand.
const importRowSchema = z.object({
  company_id: z.string().uuid(),
  debtor_id: z.string().uuid(),
  invoice_number: z.string().min(1),
  face_amount: z.number().positive(),
  advanced_on: z.string(),
  invoice_due_on: z.string().nullable().optional(),
  fee_schedule_id: z.string().uuid().nullable().optional(),
});

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // Minimal RFC-4180 handling: quoted fields may contain commas.
    const cells: string[] = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

adminRouter.post(
  '/invoices/import',
  validate(z.object({ csv: z.string().min(1).max(2_000_000), dry_run: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const { csv, dry_run } = req.body as { csv: string; dry_run: boolean };
    const raw = parseCsv(csv);

    const errors: { row: number; message: string }[] = [];
    const valid: z.infer<typeof importRowSchema>[] = [];

    raw.forEach((r, i) => {
      const parsed = importRowSchema.safeParse({
        ...r,
        face_amount: r['face_amount'] ? Number(r['face_amount']) : undefined,
        invoice_due_on: r['invoice_due_on'] || null,
        fee_schedule_id: r['fee_schedule_id'] || null,
      });
      if (parsed.success) valid.push(parsed.data);
      else {
        errors.push({
          row: i + 2, // +2: 1-indexed, plus the header line
          message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
      }
    });

    // Nothing is written unless every row parses. A partial import of advances is
    // worse than no import.
    if (dry_run || errors.length) {
      res.json({
        data: {
          dry_run: true,
          applied: 0,
          would_apply: valid.length,
          errors,
          preview: valid.slice(0, 20),
        },
      });
      return;
    }

    const created = await withAdminTransaction(async (c) => {
      const out = [];
      for (const row of valid) {
        out.push(await fundInvoice(c, row, req.platform.userId, req.ip ?? null));
      }
      return out;
    });

    res.status(201).json({ data: { dry_run: false, applied: created.length, errors: [] } });
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
