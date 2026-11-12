import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type pg from 'pg';
import {
  APPLICATION_CONSENT_VERSION, APPLICATION_REQUIRED_FIELDS,
} from '@constructpm/shared';
import { writePool, withApplication } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { notify, OPS_INBOX } from '../../lib/mailer.js';
import {
  encryptSecret, formatMasked, nineDigits, secretsConfigured, validateSecret,
} from '../../lib/secrets.js';
import { deleteObject, deliverAttachment, receiveFileUpload } from '../../lib/storage.js';
import {
  applyRateLimit, applyStartRateLimit, applyUploadRateLimit, asyncHandler, validate,
} from '../../middleware/index.js';

/**
 * Public funding application — apply.os-funding.com.
 *
 * For prospects who come for funding, not the software: no account. Starting
 * an application returns a resume token (and emails a resume link when mail is
 * configured). Every later call carries the token in X-Application-Token; the
 * web app keeps it in the URL fragment, which browsers never send to a server,
 * so it stays out of access logs and Referer headers.
 *
 * Only the SHA-256 of the token is stored. It resolves to an application id
 * through application_id_for_token(), and each request runs with
 * app.application_id set, so the database shows that one application and
 * nothing else (V013).
 */
export const applyRouter = Router();

const TOKEN_TTL_DAYS = 30;
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUIREMENT = 5;
const MAX_FILES_PER_APPLICATION = 40;
const DOC_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

declare global {
  namespace Express {
    interface Request {
      /** Set by requireApplication from the resume token. */
      applicationId?: string;
    }
  }
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
export const resumeLink = (token: string) => `${env.APPLY_URL.replace(/\/+$/, '')}/#t=${token}`;

applyRouter.use(applyRateLimit);
applyRouter.use((_req, res, next) => {
  if (!secretsConfigured) {
    res.status(503).json({
      error: 'not_configured',
      message: 'Online applications are temporarily unavailable. Please call us to apply.',
    });
    return;
  }
  next();
});

// ─── Requirements ─────────────────────────────────────────────────────────────

interface Requirement {
  key: string; label: string; description: string | null;
  kind: 'document' | 'ein' | 'ssn'; required: boolean; has_template: boolean;
}

async function activeRequirements(c: pg.PoolClient | pg.Pool): Promise<Requirement[]> {
  const r = await c.query<Requirement>(
    `SELECT key, label, description, kind, required, (template_storage_key IS NOT NULL) AS has_template
       FROM application_requirements WHERE active ORDER BY sort_order, label`);
  return r.rows;
}

applyRouter.get('/requirements', asyncHandler(async (_req, res) => {
  res.json({ data: await activeRequirements(writePool) });
}));

/** The blank form for a requirement (e.g. the payment directive), when One Source has uploaded one. */
applyRouter.get('/requirements/:key/template', asyncHandler(async (req, res) => {
  const r = await writePool.query(
    `SELECT template_name AS original_name, template_storage_key AS storage_key,
            template_content_type AS content_type
       FROM application_requirements
      WHERE key = $1 AND active AND template_storage_key IS NOT NULL`, [req.params['key']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'No form for that item' }); return; }
  await deliverAttachment(res, r.rows[0]);
}));

// ─── Start ────────────────────────────────────────────────────────────────────

const startSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(30).optional().nullable(),
  legal_name: z.string().trim().min(2).max(200),
  // Honeypot: hidden from people, filled in by bots.
  company_website: z.string().max(200).optional(),
});

applyRouter.post('/start', applyStartRateLimit, validate(startSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof startSchema>;
  if (b.company_website) {
    // Look successful to the bot; store nothing.
    res.status(201).json({ data: { token: newToken(), application: null } });
    return;
  }
  const id = randomUUID();
  const token = newToken();
  await withApplication(id, (c) => c.query(
    `INSERT INTO funding_applications
       (id, contact_first_name, contact_last_name, contact_email, contact_phone, legal_name,
        token_hash, token_expires_at, created_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + make_interval(days => $8), $9)`,
    [id, b.first_name, b.last_name, b.email, b.phone || null, b.legal_name, hashToken(token),
     TOKEN_TTL_DAYS, req.ip ?? null]));

  void notify({
    to: b.email,
    subject: 'Your One Source Funding application',
    text: `Hi ${b.first_name},\n\n`
        + `Thanks for starting an application with One Source Funding. You can come back and `
        + `finish it any time in the next ${TOKEN_TTL_DAYS} days with this private link:\n\n`
        + `${resumeLink(token)}\n\n`
        + `Keep this link to yourself — anyone with it can see your application.\n\n`
        + `Questions? Reply to this email or call us.\n\nOne Source Funding`,
  });

  res.status(201).json({ data: { token, application_id: id } });
}));

// ─── Everything below needs the resume token ──────────────────────────────────

async function requireApplication(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-application-token');
  if (!token || token.length < 20 || token.length > 200) {
    res.status(401).json({ error: 'no_application', message: 'This application link is missing or incomplete.' });
    return;
  }
  try {
    const r = await writePool.query<{ id: string | null }>(
      `SELECT application_id_for_token($1) AS id`, [hashToken(token)]);
    if (!r.rows[0]?.id) {
      res.status(401).json({
        error: 'no_application',
        message: 'This application link has expired or is no longer active. Start a new application or call us.',
      });
      return;
    }
    req.applicationId = r.rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}

applyRouter.use('/me', requireApplication);

const APPLICANT_FIELDS = `id, status, contact_first_name, contact_last_name, contact_email, contact_phone,
  legal_name, dba, entity_type, state_of_formation, years_in_business, address_line1, city, state_code, zip,
  agencies, monthly_volume, typical_invoice, typical_days_to_pay, has_existing_lender, existing_lender,
  owner_name, owner_title, owner_ownership_pct, signer_name, signer_title, how_heard,
  signature_name, signed_at, submitted_at, request_message, requested_items, created_at, updated_at`;

interface ItemRow {
  id: string; requirement_key: string; kind: 'document' | 'ein' | 'ssn';
  original_name: string | null; size_bytes: string | null; value_last4: string | null;
  source: string; note: string | null; created_at: string;
}

/** What's still needed before this application can be submitted. */
function missingFor(app: Record<string, unknown>, reqs: Requirement[], items: ItemRow[]) {
  const fields = APPLICATION_REQUIRED_FIELDS
    .filter(([k]) => app[k] === null || app[k] === undefined || String(app[k]).trim() === '')
    .map(([key, label]) => ({ key, label }));
  const have = new Set(items.map((i) => i.requirement_key));
  const items_missing = reqs.filter((r) => r.required && !have.has(r.key))
    .map((r) => ({ key: r.key, label: r.label }));
  return { fields, items: items_missing };
}

async function loadState(c: pg.PoolClient) {
  const [app, items, reqs] = await Promise.all([
    c.query(`SELECT ${APPLICANT_FIELDS} FROM funding_applications`),
    c.query<ItemRow>(
      `SELECT id, requirement_key, kind, original_name, size_bytes, value_last4, source, note, created_at
         FROM funding_application_items ORDER BY created_at`),
    activeRequirements(c),
  ]);
  const a = app.rows[0];
  if (!a) throw Object.assign(new Error('Application not found'), { status: 404 });
  return {
    application: a,
    items: items.rows.map((i) => ({
      id: i.id, requirement_key: i.requirement_key, kind: i.kind, source: i.source, note: i.note,
      created_at: i.created_at,
      ...(i.kind === 'document'
        ? { original_name: i.original_name, size_bytes: i.size_bytes === null ? null : Number(i.size_bytes) }
        : { masked: formatMasked(i.kind, i.value_last4) }),
    })),
    requirements: reqs,
    missing: missingFor(a, reqs, items.rows),
    editable: a['status'] === 'draft' || a['status'] === 'docs_requested',
  };
}

applyRouter.get('/me', asyncHandler(async (req, res) => {
  res.json({ data: await withApplication(req.applicationId!, loadState) });
}));

const twoLetters = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use the two-letter state code');
const updateSchema = z.object({
  contact_first_name: z.string().trim().min(1).max(80),
  contact_last_name: z.string().trim().min(1).max(80),
  contact_email: z.string().trim().toLowerCase().email().max(254),
  contact_phone: z.string().trim().max(30).nullable(),
  legal_name: z.string().trim().min(2).max(200),
  dba: z.string().trim().max(200).nullable(),
  entity_type: z.enum(['llc', 'corporation', 's_corporation', 'partnership', 'sole_proprietorship', 'other']).nullable(),
  state_of_formation: twoLetters.nullable(),
  years_in_business: z.number().min(0).max(200).nullable(),
  address_line1: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  state_code: twoLetters.nullable(),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Use a 5-digit ZIP code').nullable(),
  agencies: z.string().trim().max(2000).nullable(),
  monthly_volume: z.number().min(0).max(1e9).nullable(),
  typical_invoice: z.number().min(0).max(1e9).nullable(),
  typical_days_to_pay: z.number().int().min(0).max(730).nullable(),
  has_existing_lender: z.boolean().nullable(),
  existing_lender: z.string().trim().max(200).nullable(),
  owner_name: z.string().trim().max(160).nullable(),
  owner_title: z.string().trim().max(100).nullable(),
  owner_ownership_pct: z.number().min(0).max(100).nullable(),
  signer_name: z.string().trim().max(160).nullable(),
  signer_title: z.string().trim().max(100).nullable(),
  how_heard: z.string().trim().max(200).nullable(),
}).partial().strict();

/** Postgres refused the change because the application is no longer editable. */
function lockedError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e.code === '23514' && /locked|only submit/.test(e.message ?? '')) {
    throw Object.assign(new Error('This application has been submitted and can’t be changed. Call us if something needs correcting.'), { status: 409 });
  }
  throw err;
}

applyRouter.patch('/me', validate(updateSchema), asyncHandler(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const keys = Object.keys(b);
  const data = await withApplication(req.applicationId!, async (c) => {
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      await c.query(
        `UPDATE funding_applications SET ${sets.join(', ')},
                token_expires_at = GREATEST(token_expires_at, NOW() + make_interval(days => ${TOKEN_TTL_DAYS}))`,
        keys.map((k) => b[k])).catch(lockedError);
    }
    return loadState(c);
  });
  res.json({ data });
}));

// ─── Sensitive numbers (EIN, SSN) ─────────────────────────────────────────────

applyRouter.put('/me/numbers/:key', validate(z.object({ value: z.string().max(20) })),
  asyncHandler(async (req, res) => {
    const digits = nineDigits((req.body as { value: string }).value);
    const data = await withApplication(req.applicationId!, async (c) => {
      const r = await c.query<{ kind: 'document' | 'ein' | 'ssn' }>(
        `SELECT kind FROM application_requirements WHERE key = $1 AND active`, [req.params['key']]);
      const kind = r.rows[0]?.kind;
      if (kind !== 'ein' && kind !== 'ssn') {
        throw Object.assign(new Error('Unknown item'), { status: 404 });
      }
      if (!digits) {
        throw Object.assign(new Error(kind === 'ein' ? 'Enter the 9-digit EIN' : 'Enter the 9-digit Social Security number'), { status: 422 });
      }
      const problem = validateSecret(kind, digits);
      if (problem) throw Object.assign(new Error(problem), { status: 422 });

      await c.query(
        `DELETE FROM funding_application_items WHERE requirement_key = $1 AND source = 'applicant'`,
        [req.params['key']]).catch(lockedError);
      await c.query(
        `INSERT INTO funding_application_items (application_id, requirement_key, kind, value_encrypted, value_last4)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.applicationId, req.params['key'], kind, encryptSecret(digits), digits.slice(-4)])
        .catch((err: { code?: string }) => {
          if (err.code === '42501') throw Object.assign(new Error('This application has been submitted and can’t be changed.'), { status: 409 });
          throw err;
        });
      return loadState(c);
    });
    res.json({ data });
  }));

// ─── Documents ────────────────────────────────────────────────────────────────

/**
 * Multipart: `requirement_key` field first, then the file. The field has to
 * come first — the storage key is chosen from it before the file is stored.
 */
applyRouter.post('/me/documents', applyUploadRateLimit, asyncHandler(async (req, res) => {
  const applicationId = req.applicationId!;
  let stored: Awaited<ReturnType<typeof receiveFileUpload>> | null = null;
  try {
    stored = await receiveFileUpload(req, {
      allowedMime: DOC_MIME,
      maxBytes: MAX_DOC_BYTES,
      keyFor: async (fields, safeName) => {
        const key = fields['requirement_key'] ?? '';
        await withApplication(applicationId, async (c) => {
          const [r, a, counts] = await Promise.all([
            c.query(`SELECT 1 FROM application_requirements WHERE key = $1 AND active AND kind = 'document'`, [key]),
            c.query<{ status: string }>(`SELECT status FROM funding_applications`),
            c.query<{ total: string; for_key: string }>(
              `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE requirement_key = $1) AS for_key
                 FROM funding_application_items WHERE kind = 'document'`, [key]),
          ]);
          if (!r.rows[0]) throw Object.assign(new Error('Unknown document type'), { status: 422 });
          if (!['draft', 'docs_requested'].includes(a.rows[0]?.status ?? '')) {
            throw Object.assign(new Error('This application has been submitted and can’t be changed.'), { status: 409 });
          }
          if (Number(counts.rows[0]!.for_key) >= MAX_FILES_PER_REQUIREMENT
              || Number(counts.rows[0]!.total) >= MAX_FILES_PER_APPLICATION) {
            throw Object.assign(new Error('That’s the maximum number of files for this item. Remove one first.'), { status: 422 });
          }
        });
        return `applications/${applicationId}/${randomUUID()}-${safeName}`;
      },
    });
    const s = stored;
    const data = await withApplication(applicationId, async (c) => {
      await c.query(
        `INSERT INTO funding_application_items
           (application_id, requirement_key, kind, storage_key, original_name, content_type, size_bytes)
         VALUES ($1,$2,'document',$3,$4,$5,$6)`,
        [applicationId, s.fields['requirement_key'], s.key, s.safeName, s.contentType, s.size]);
      return loadState(c);
    });
    res.status(201).json({ data });
  } catch (err) {
    if (stored) await deleteObject(stored.key);
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) throw err;
    res.status(status).json({ error: 'upload_error', message: (err as Error).message });
  }
}));

applyRouter.delete('/me/documents/:id', asyncHandler(async (req, res) => {
  const { removed, data } = await withApplication(req.applicationId!, async (c) => {
    const r = await c.query<{ storage_key: string }>(
      `DELETE FROM funding_application_items
        WHERE id = $1 AND kind = 'document' AND source = 'applicant' RETURNING storage_key`,
      [req.params['id']]);
    return { removed: r.rows[0], data: await loadState(c) };
  });
  if (!removed) {
    res.status(404).json({ error: 'not_found', message: 'That file can’t be removed now.' });
    return;
  }
  await deleteObject(removed.storage_key);
  res.json({ data });
}));

// ─── Submit ───────────────────────────────────────────────────────────────────

const submitSchema = z.object({
  signature_name: z.string().trim().min(2).max(160),
  consent: z.literal(true),
});

applyRouter.post('/me/submit', validate(submitSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof submitSchema>;
  const { data, resubmitted } = await withApplication(req.applicationId!, async (c) => {
    const before = await loadState(c);
    if (!before.editable) {
      throw Object.assign(new Error('This application has already been submitted.'), { status: 409 });
    }
    const { fields, items } = before.missing;
    if (fields.length || items.length) {
      throw Object.assign(new Error(
        `Still needed: ${[...fields, ...items].map((m) => m.label).join(', ')}`), { status: 422 });
    }
    await c.query(
      `UPDATE funding_applications
          SET status = 'submitted', submitted_at = NOW(), signature_name = $1, signed_at = NOW(),
              signed_ip = $2, consent_version = $3,
              token_expires_at = GREATEST(token_expires_at, NOW() + make_interval(days => ${TOKEN_TTL_DAYS}))`,
      [b.signature_name, req.ip ?? null, APPLICATION_CONSENT_VERSION]).catch(lockedError);
    return { data: await loadState(c), resubmitted: before.application['status'] === 'docs_requested' };
  });

  const a = data.application as Record<string, string>;
  void notify({
    to: OPS_INBOX,
    subject: `${resubmitted ? 'Application updated' : 'New funding application'} — ${a['legal_name']}`,
    text: `${resubmitted ? 'An applicant added the documents you asked for.' : 'A new funding application was submitted.'}\n\n`
        + `Business: ${a['legal_name']}\nContact:  ${a['contact_first_name']} ${a['contact_last_name']} <${a['contact_email']}>\n`
        + `Phone:    ${a['contact_phone'] ?? '—'}\n\nReview it under Applications in the operator console.`,
  });
  void notify({
    to: a['contact_email'] ?? null,
    subject: 'We received your One Source Funding application',
    text: `Hi ${a['contact_first_name']},\n\nThanks — we have your application for ${a['legal_name']}. `
        + `We’ll review it and be in touch within one business day.\n\nOne Source Funding`,
  });
  res.json({ data });
}));
