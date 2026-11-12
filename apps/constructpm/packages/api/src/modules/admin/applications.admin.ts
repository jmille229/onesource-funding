import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type pg from 'pg';
import { APPLICATION_REQUIRED_FIELDS } from '@constructpm/shared';
import { adminPool, withAdminTransaction, audit } from '../../lib/admin-db.js';
import { env } from '../../lib/env.js';
import { notify } from '../../lib/mailer.js';
import { decryptSecret, formatMasked } from '../../lib/secrets.js';
import { deleteObject, deliverAttachment, receiveFileUpload } from '../../lib/storage.js';
import { asyncHandler, validate } from '../../middleware/index.js';
import { resumeLink } from '../apply/apply.router.js';

/**
 * Operator side of funding applications (V013): the Applications queue,
 * the requirements list, and approval — which creates the client's company,
 * their login and an active funding client in one step.
 *
 * Mounted under /api/admin, behind operator authentication.
 */
export const applicationsAdminRouter = Router();

const INVITE_TTL_DAYS = 14;
const TOKEN_TTL_DAYS = 30;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const inviteLink = (token: string) => `${env.APP_URL.replace(/\/+$/, '')}/accept-invite#token=${token}`;

function pool(): pg.Pool {
  if (!adminPool) throw Object.assign(new Error('admin not configured'), { status: 503 });
  return adminPool;
}

const notFound = () => Object.assign(new Error('Application not found'), { status: 404 });

// ─── Queue ────────────────────────────────────────────────────────────────────

applicationsAdminRouter.get('/applications/counts', asyncHandler(async (_req, res) => {
  const r = await pool().query<{ status: string; n: string }>(
    `SELECT status, COUNT(*) AS n FROM funding_applications GROUP BY status`);
  res.json({ data: Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)])) });
}));

applicationsAdminRouter.get('/applications', asyncHandler(async (req, res) => {
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : '';
  const allowed = ['draft', 'submitted', 'in_review', 'docs_requested', 'approved', 'declined', 'withdrawn'];
  const where = status === 'open'
    ? `WHERE a.status IN ('submitted','in_review','docs_requested')`
    : allowed.includes(status) ? `WHERE a.status = $1` : '';
  const r = await pool().query(
    `SELECT a.id, a.status, a.legal_name, a.dba, a.contact_first_name, a.contact_last_name,
            a.contact_email, a.contact_phone, a.monthly_volume, a.agencies,
            a.submitted_at, a.reviewed_at, a.created_at, a.updated_at, a.company_id,
            COUNT(i.id) FILTER (WHERE i.kind = 'document' AND i.storage_key IS NOT NULL) AS document_count,
            COALESCE(array_agg(DISTINCT i.requirement_key) FILTER (WHERE i.id IS NOT NULL), '{}') AS provided,
            (SELECT COALESCE(array_agg(key), '{}') FROM application_requirements WHERE active AND required) AS required_keys
       FROM funding_applications a
       LEFT JOIN funding_application_items i ON i.application_id = a.id
       ${where}
      GROUP BY a.id
      ORDER BY CASE WHEN a.status IN ('submitted','docs_requested','in_review') THEN 0 ELSE 1 END,
               COALESCE(a.submitted_at, a.created_at) DESC
      LIMIT 500`, where.includes('$1') ? [status] : []);
  res.json({
    data: r.rows.map((row) => {
      const provided = new Set(row['provided'] as string[]);
      const { provided: _p, required_keys, ...rest } = row as Record<string, unknown> & { required_keys: string[] };
      return { ...rest, missing_count: required_keys.filter((k) => !provided.has(k)).length };
    }),
  });
}));

async function loadApplication(c: pg.Pool | pg.PoolClient, id: string) {
  const [app, items, reqs, existing] = await Promise.all([
    c.query(`SELECT * FROM funding_applications WHERE id = $1`, [id]),
    c.query(
      `SELECT id, requirement_key, kind, original_name, content_type, size_bytes, value_last4,
              source, note, created_at
         FROM funding_application_items WHERE application_id = $1 ORDER BY created_at`, [id]),
    c.query(`SELECT key, label, description, kind, required, active, sort_order,
                    (template_storage_key IS NOT NULL) AS has_template
               FROM application_requirements ORDER BY sort_order, label`),
    c.query(`SELECT * FROM application_existing_login($1)`, [id]),
  ]);
  const a = app.rows[0];
  if (!a) throw notFound();
  delete a['token_hash'];
  const have = new Set(items.rows.map((i) => i['requirement_key']));
  return {
    application: a,
    items: items.rows.map((i) => ({
      ...i,
      masked: i['kind'] === 'document' ? null : formatMasked(i['kind'], i['value_last4']),
    })),
    requirements: reqs.rows,
    // The applicant's email already has a login: approving turns funding on
    // for that company instead of creating a new one.
    existing_login: a['status'] === 'approved' ? null : (existing.rows[0] ?? null),
    missing: {
      fields: APPLICATION_REQUIRED_FIELDS
        .filter(([k]) => a[k] === null || a[k] === undefined || String(a[k]).trim() === '')
        .map(([key, label]) => ({ key, label })),
      items: reqs.rows.filter((r) => r['active'] && r['required'] && !have.has(r['key']))
        .map((r) => ({ key: r['key'], label: r['label'] })),
    },
  };
}

applicationsAdminRouter.get('/applications/:id', asyncHandler(async (req, res) => {
  res.json({ data: await loadApplication(pool(), String(req.params['id'])) });
}));

applicationsAdminRouter.get('/applications/:id/items/:itemId/download', asyncHandler(async (req, res) => {
  const r = await pool().query(
    `SELECT id, original_name, storage_key, content_type, requirement_key FROM funding_application_items
      WHERE id = $1 AND application_id = $2 AND kind = 'document' AND storage_key IS NOT NULL`,
    [req.params['itemId'], req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Document not found' }); return; }
  await withAdminTransaction((c) => audit(c, {
    platformUserId: req.platform.userId, action: 'download_application_document',
    entityType: 'funding_application', entityId: String(req.params['id']),
    after: { item_id: r.rows[0]!['id'], requirement: r.rows[0]!['requirement_key'] }, ip: req.ip ?? null,
  }));
  await deliverAttachment(res, r.rows[0]!);
}));

/** Show an EIN/SSN in full. Every reveal is written to the audit log (the value isn't). */
applicationsAdminRouter.post('/applications/:id/items/:itemId/reveal', asyncHandler(async (req, res) => {
  const value = await withAdminTransaction(async (c) => {
    const r = await c.query<{ kind: string; value_encrypted: string; requirement_key: string }>(
      `SELECT kind, value_encrypted, requirement_key FROM funding_application_items
        WHERE id = $1 AND application_id = $2 AND kind IN ('ein','ssn') AND value_encrypted IS NOT NULL`,
      [req.params['itemId'], req.params['id']]);
    const row = r.rows[0];
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    await audit(c, {
      platformUserId: req.platform.userId, action: 'reveal_application_number',
      entityType: 'funding_application', entityId: String(req.params['id']),
      after: { item_id: req.params['itemId'], requirement: row.requirement_key }, ip: req.ip ?? null,
    });
    const digits = decryptSecret(row.value_encrypted);
    return row.kind === 'ein'
      ? `${digits.slice(0, 2)}-${digits.slice(2)}`
      : `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { value } });
}));

// ─── Review actions ───────────────────────────────────────────────────────────

async function rotateResumeToken(c: pg.PoolClient, id: string): Promise<string> {
  const token = newToken();
  await c.query(
    `UPDATE funding_applications SET token_hash = $2,
            token_expires_at = NOW() + make_interval(days => ${TOKEN_TTL_DAYS})
      WHERE id = $1`, [id, hashToken(token)]);
  return token;
}

applicationsAdminRouter.post('/applications/:id/in-review', asyncHandler(async (req, res) => {
  const row = await withAdminTransaction(async (c) => {
    const r = await c.query(
      `UPDATE funding_applications SET status = 'in_review'
        WHERE id = $1 AND status IN ('submitted','docs_requested') RETURNING id, status`, [req.params['id']]);
    if (!r.rows[0]) throw Object.assign(new Error('Only a submitted application can be put in review'), { status: 409 });
    await audit(c, { platformUserId: req.platform.userId, action: 'application_in_review',
      entityType: 'funding_application', entityId: String(req.params['id']), ip: req.ip ?? null });
    return r.rows[0];
  });
  res.json({ data: row });
}));

/**
 * Ask the applicant for more. Reopens the application for them and makes a
 * fresh resume link — emailed when mail is set up, and returned here so it can
 * be sent by hand either way. (Their previous link stops working.)
 */
applicationsAdminRouter.post('/applications/:id/request-documents',
  validate(z.object({
    items: z.array(z.string().max(40)).max(50).default([]),
    message: z.string().trim().min(1).max(2000),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as { items: string[]; message: string };
    const out = await withAdminTransaction(async (c) => {
      const r = await c.query<{ contact_email: string; contact_first_name: string; legal_name: string }>(
        `UPDATE funding_applications
            SET status = 'docs_requested', requested_items = $2, request_message = $3
          WHERE id = $1 AND status IN ('submitted','in_review','docs_requested')
          RETURNING contact_email, contact_first_name, legal_name`,
        [req.params['id'], b.items, b.message]);
      if (!r.rows[0]) throw Object.assign(new Error('Only a submitted application can be sent back'), { status: 409 });
      const token = await rotateResumeToken(c, String(req.params['id']));
      await audit(c, { platformUserId: req.platform.userId, action: 'application_request_documents',
        entityType: 'funding_application', entityId: String(req.params['id']),
        after: { items: b.items }, ip: req.ip ?? null });
      return { ...r.rows[0]!, link: resumeLink(token) };
    });
    void notify({
      to: out.contact_email,
      subject: 'One Source Funding needs a little more for your application',
      text: `Hi ${out.contact_first_name},\n\n${b.message}\n\n`
          + `Add it to your application for ${out.legal_name} here:\n${out.link}\n\n`
          + `This link replaces any earlier one.\n\nOne Source Funding`,
    });
    res.json({ data: { resume_link: out.link } });
  }));

/** A fresh resume link to send by hand (the old one stops working). */
applicationsAdminRouter.post('/applications/:id/resume-link', asyncHandler(async (req, res) => {
  const link = await withAdminTransaction(async (c) => {
    const r = await c.query(`SELECT status FROM funding_applications WHERE id = $1`, [req.params['id']]);
    if (!r.rows[0]) throw notFound();
    if (!['draft', 'submitted', 'in_review', 'docs_requested'].includes(r.rows[0]['status'])) {
      throw Object.assign(new Error('This application is closed'), { status: 409 });
    }
    const token = await rotateResumeToken(c, String(req.params['id']));
    await audit(c, { platformUserId: req.platform.userId, action: 'application_resume_link',
      entityType: 'funding_application', entityId: String(req.params['id']), ip: req.ip ?? null });
    return resumeLink(token);
  });
  res.json({ data: { resume_link: link } });
}));

applicationsAdminRouter.post('/applications/:id/decline',
  validate(z.object({ reason: z.string().trim().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const reason = (req.body as { reason: string }).reason;
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `UPDATE funding_applications
            SET status = 'declined', decline_reason = $2, reviewed_at = NOW(), token_hash = NULL
          WHERE id = $1 AND status IN ('submitted','in_review','docs_requested') RETURNING id, status`,
        [req.params['id'], reason]);
      if (!r.rows[0]) throw Object.assign(new Error('Only a submitted application can be declined'), { status: 409 });
      await audit(c, { platformUserId: req.platform.userId, action: 'application_decline',
        entityType: 'funding_application', entityId: String(req.params['id']),
        after: { reason }, ip: req.ip ?? null });
      return r.rows[0];
    });
    res.json({ data: row });
  }));

/** Record that a requirement arrived outside the app (e.g. signed in PandaDoc). */
applicationsAdminRouter.post('/applications/:id/mark-received',
  validate(z.object({
    requirement_key: z.string().max(40),
    note: z.string().trim().min(1).max(300),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as { requirement_key: string; note: string };
    await withAdminTransaction(async (c) => {
      const r = await c.query<{ kind: string }>(
        `SELECT kind FROM application_requirements WHERE key = $1`, [b.requirement_key]);
      if (!r.rows[0]) throw Object.assign(new Error('Unknown requirement'), { status: 422 });
      const a = await c.query(`SELECT 1 FROM funding_applications WHERE id = $1`, [req.params['id']]);
      if (!a.rows[0]) throw notFound();
      await c.query(
        `INSERT INTO funding_application_items (application_id, requirement_key, kind, source, note)
         VALUES ($1,$2,$3,'operator',$4)`, [req.params['id'], b.requirement_key, r.rows[0].kind, b.note]);
      await audit(c, { platformUserId: req.platform.userId, action: 'application_mark_received',
        entityType: 'funding_application', entityId: String(req.params['id']),
        after: b, ip: req.ip ?? null });
    });
    res.json({ data: await loadApplication(pool(), String(req.params['id'])) });
  }));

applicationsAdminRouter.delete('/applications/:id/items/:itemId', asyncHandler(async (req, res) => {
  await withAdminTransaction(async (c) => {
    const r = await c.query(
      `DELETE FROM funding_application_items WHERE id = $1 AND application_id = $2 AND source = 'operator'
       RETURNING requirement_key`, [req.params['itemId'], req.params['id']]);
    if (!r.rows[0]) throw Object.assign(new Error('Only items you marked received can be removed here'), { status: 404 });
    await audit(c, { platformUserId: req.platform.userId, action: 'application_unmark_received',
      entityType: 'funding_application', entityId: String(req.params['id']),
      after: r.rows[0], ip: req.ip ?? null });
  });
  res.json({ data: await loadApplication(pool(), String(req.params['id'])) });
}));

// ─── Approval ─────────────────────────────────────────────────────────────────

async function issueInvite(c: pg.PoolClient, userId: string): Promise<string> {
  const token = newToken();
  await c.query(`SELECT create_user_invite($1, $2, $3)`, [userId, hashToken(token), INVITE_TTL_DAYS]);
  return inviteLink(token);
}

function sendInvite(to: string, firstName: string, link: string) {
  void notify({
    to,
    subject: 'Your One Source Funding account is ready',
    text: `Hi ${firstName},\n\nWelcome to One Source Funding — your application is approved.\n\n`
        + `Set your password here to sign in, submit invoices for funding and follow every advance:\n`
        + `${link}\n\nThe link works once and expires in ${INVITE_TTL_DAYS} days.\n\nOne Source Funding`,
  });
}

/**
 * Approve: create (or reuse) the client's company and login, make them an
 * active funding client on the chosen fee schedule, and issue a set-password
 * invite. If the applicant's email already has a ConstructPM login, that
 * company is used and no invite is needed.
 */
applicationsAdminRouter.post('/applications/:id/approve',
  validate(z.object({
    fee_schedule_id: z.string().uuid(),
    credit_limit: z.number().nonnegative().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as { fee_schedule_id: string; credit_limit?: number | null };
    const out = await withAdminTransaction(async (c) => {
      const before = await c.query<{ contact_email: string; contact_first_name: string }>(
        `SELECT contact_email, contact_first_name FROM funding_applications WHERE id = $1`, [req.params['id']]);
      if (!before.rows[0]) throw notFound();
      const r = await c.query<{ company_id: string; user_id: string; created_user: boolean }>(
        `SELECT * FROM application_provision_client($1, $2, $3)`,
        [req.params['id'], b.fee_schedule_id, b.credit_limit ?? null])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === '23514' || err.code === 'P0002') {
            throw Object.assign(new Error(err.message ?? 'Cannot approve'), { status: 409 });
          }
          if (err.code === '23503') throw Object.assign(new Error('Unknown fee schedule'), { status: 422 });
          throw err;
        });
      const p = r.rows[0]!;
      const link = p.created_user ? await issueInvite(c, p.user_id) : null;
      await audit(c, {
        platformUserId: req.platform.userId, action: 'application_approve',
        entityType: 'funding_application', entityId: String(req.params['id']), companyId: p.company_id,
        after: { ...p, fee_schedule_id: b.fee_schedule_id, credit_limit: b.credit_limit ?? null },
        ip: req.ip ?? null,
      });
      return { ...p, invite_link: link, email: before.rows[0].contact_email,
               first_name: before.rows[0].contact_first_name };
    });
    if (out.invite_link) sendInvite(out.email, out.first_name, out.invite_link);
    else {
      void notify({
        to: out.email,
        subject: 'Your One Source Funding application is approved',
        text: `Hi ${out.first_name},\n\nYour application is approved. Funding is now turned on in your `
            + `existing account — sign in at ${env.APP_URL} and open Funding.\n\nOne Source Funding`,
      });
    }
    res.json({ data: {
      company_id: out.company_id, created_login: out.created_user, invite_link: out.invite_link,
    } });
  }));

/** A new set-password link for an approved applicant (also works as a reset). */
applicationsAdminRouter.post('/applications/:id/invite', asyncHandler(async (req, res) => {
  const out = await withAdminTransaction(async (c) => {
    const r = await c.query<{ approved_user_id: string | null; contact_email: string; contact_first_name: string }>(
      `SELECT approved_user_id, contact_email, contact_first_name FROM funding_applications
        WHERE id = $1 AND status = 'approved'`, [req.params['id']]);
    const row = r.rows[0];
    if (!row?.approved_user_id) throw Object.assign(new Error('Only an approved application has a login'), { status: 409 });
    const link = await issueInvite(c, row.approved_user_id);
    await audit(c, { platformUserId: req.platform.userId, action: 'application_reinvite',
      entityType: 'funding_application', entityId: String(req.params['id']), ip: req.ip ?? null });
    return { ...row, link };
  });
  sendInvite(out.contact_email, out.contact_first_name, out.link);
  res.json({ data: { invite_link: out.link } });
}));

// ─── Requirements ─────────────────────────────────────────────────────────────

applicationsAdminRouter.get('/application-requirements', asyncHandler(async (_req, res) => {
  const r = await pool().query(
    `SELECT id, key, label, description, kind, required, active, sort_order, template_name,
            (template_storage_key IS NOT NULL) AS has_template
       FROM application_requirements ORDER BY sort_order, label`);
  res.json({ data: r.rows });
}));

const requirementFields = {
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).nullable().optional(),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
};

applicationsAdminRouter.post('/application-requirements',
  validate(z.object({
    ...requirementFields,
    key: z.string().regex(/^[a-z0-9_]{2,40}$/, 'Lowercase letters, numbers and underscores'),
    kind: z.enum(['document', 'ein', 'ssn']).default('document'),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `INSERT INTO application_requirements (key, label, description, kind, required, active, sort_order)
         VALUES ($1,$2,$3,$4,COALESCE($5,true),COALESCE($6,true),COALESCE($7,100)) RETURNING *`,
        [b['key'], b['label'], b['description'] ?? null, b['kind'], b['required'] ?? null,
         b['active'] ?? null, b['sort_order'] ?? null])
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw Object.assign(new Error('That key is already used'), { status: 409 });
          throw err;
        });
      await audit(c, { platformUserId: req.platform.userId, action: 'create',
        entityType: 'application_requirement', entityId: r.rows[0]!['id'], after: r.rows[0], ip: req.ip ?? null });
      return r.rows[0];
    });
    res.status(201).json({ data: row });
  }));

applicationsAdminRouter.patch('/application-requirements/:id',
  validate(z.object(requirementFields).partial().strict()),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const keys = Object.keys(b);
    if (!keys.length) { res.status(422).json({ error: 'validation_error', message: 'Nothing to change' }); return; }
    const row = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM application_requirements WHERE id = $1`, [req.params['id']]);
      if (!before.rows[0]) throw Object.assign(new Error('Requirement not found'), { status: 404 });
      const r = await c.query(
        `UPDATE application_requirements SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING *`, [req.params['id'], ...keys.map((k) => b[k])]);
      await audit(c, { platformUserId: req.platform.userId, action: 'update',
        entityType: 'application_requirement', entityId: String(req.params['id']),
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null });
      return r.rows[0];
    });
    res.json({ data: row });
  }));

/** Upload the blank form applicants download (PDF or Word). Replaces any earlier one. */
applicationsAdminRouter.post('/application-requirements/:id/template', asyncHandler(async (req, res) => {
  const exists = await pool().query(`SELECT template_storage_key FROM application_requirements WHERE id = $1`,
    [req.params['id']]);
  if (!exists.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Requirement not found' }); return; }
  let stored: Awaited<ReturnType<typeof receiveFileUpload>> | null = null;
  try {
    stored = await receiveFileUpload(req, {
      allowedMime: new Set(['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
      maxBytes: 15 * 1024 * 1024,
      keyFor: (_f, safeName) => `application-templates/${req.params['id']}/${randomUUID()}-${safeName}`,
    });
    const s = stored;
    const row = await withAdminTransaction(async (c) => {
      const r = await c.query(
        `UPDATE application_requirements
            SET template_storage_key = $2, template_name = $3, template_content_type = $4
          WHERE id = $1 RETURNING id, key, template_name`, [req.params['id'], s.key, s.safeName, s.contentType]);
      await audit(c, { platformUserId: req.platform.userId, action: 'upload_template',
        entityType: 'application_requirement', entityId: String(req.params['id']),
        after: r.rows[0], ip: req.ip ?? null });
      return r.rows[0];
    });
    if (exists.rows[0]['template_storage_key']) await deleteObject(exists.rows[0]['template_storage_key']);
    res.json({ data: row });
  } catch (err) {
    if (stored) await deleteObject(stored.key);
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) throw err;
    res.status(status).json({ error: 'upload_error', message: (err as Error).message });
  }
}));

applicationsAdminRouter.delete('/application-requirements/:id/template', asyncHandler(async (req, res) => {
  const old = await withAdminTransaction(async (c) => {
    const r = await c.query<{ template_storage_key: string | null }>(
      `SELECT template_storage_key FROM application_requirements WHERE id = $1 FOR UPDATE`, [req.params['id']]);
    if (!r.rows[0]) throw Object.assign(new Error('Requirement not found'), { status: 404 });
    await c.query(
      `UPDATE application_requirements
          SET template_storage_key = NULL, template_name = NULL, template_content_type = NULL WHERE id = $1`,
      [req.params['id']]);
    await audit(c, { platformUserId: req.platform.userId, action: 'remove_template',
      entityType: 'application_requirement', entityId: String(req.params['id']), ip: req.ip ?? null });
    return r.rows[0].template_storage_key;
  });
  if (old) await deleteObject(old);
  res.json({ data: { removed: Boolean(old) } });
}));
