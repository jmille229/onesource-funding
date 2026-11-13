import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { adminPool, withAdminTransaction, audit } from '../../lib/admin-db.js';
import { asyncHandler, validate } from '../../middleware/index.js';
import { emailInvite, INVITE_TTL_DAYS, inviteLink, newInviteToken } from './invites.js';

/**
 * Adding and managing funding clients by hand in the operator console (V014):
 * for clients signed outside the online application — a referral, a phone
 * call, the existing book.
 *
 * Creating a client makes a company (funding-only portal), a funding client on
 * the chosen terms, and — when there's an email — an owner login with a
 * set-password link, shown to copy and emailed when mail is set up. Mounted
 * under /api/admin, behind operator authentication.
 */
export const clientsAdminRouter = Router();

const conflict = (message: string, code?: string) => Object.assign(new Error(message), { status: 409, code });
const notFound = () => Object.assign(new Error('Client not found'), { status: 404 });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');

function pool(): pg.Pool {
  if (!adminPool) throw Object.assign(new Error('admin not configured'), { status: 503 });
  return adminPool;
}

/** Map the database's refusals to messages the console can show. */
function dbError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e.code === '23505') throw conflict('A login with that email already exists', 'login_exists');
  if (e.code === '23514') throw Object.assign(new Error(e.message ?? 'Invalid value'), { status: 422 });
  if (e.code === 'P0002') throw Object.assign(new Error(e.message ?? 'Not found'), { status: 404 });
  if (e.code === '23503') throw Object.assign(new Error('Unknown fee schedule'), { status: 422 });
  throw err;
}

async function issueClientInvite(c: pg.PoolClient, companyId: string, userId: string) {
  const { token, hash } = newInviteToken();
  const r = await c.query<{ email: string; first_name: string }>(
    `SELECT * FROM admin_client_invite($1, $2, $3, $4)`, [companyId, userId, hash, INVITE_TTL_DAYS])
    .catch(dbError);
  return { link: inviteLink(token), email: r.rows[0]!.email, first_name: r.rows[0]!.first_name };
}

const INTRO = 'One Source Funding has set up your account.';

// ─── Create ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(30).optional().nullable(),
});

const createSchema = z.object({
  legal_name: z.string().trim().min(2).max(200),
  status: z.enum(['active', 'prospect']).default('active'),
  fee_schedule_id: z.string().uuid(),
  credit_limit: z.number().nonnegative().max(1e10).nullable().optional(),
  onboarded_on: isoDate.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  login: loginSchema.nullable().optional(),
  send_invite: z.boolean().default(true),
  // The email already signs in at a company: make that company the client
  // instead of creating a new one. Sent only after the console has asked.
  use_existing_login: z.boolean().default(false),
});

clientsAdminRouter.post('/clients/new', validate(createSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const onboardedOn = b.onboarded_on ?? (b.status === 'active' ? new Date().toISOString().slice(0, 10) : null);

  const out = await withAdminTransaction(async (c) => {
    const insertClient = (companyId: string) => c.query<{ id: string }>(
      `INSERT INTO factoring_clients (company_id, status, default_fee_schedule_id, credit_limit, onboarded_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [companyId, b.status, b.fee_schedule_id, b.credit_limit ?? null, onboardedOn, b.notes || null])
      .catch(dbError);

    // An email that already signs in somewhere.
    if (b.login) {
      const existing = await c.query<{ user_id: string; company_id: string; company_name: string; user_name: string }>(
        `SELECT * FROM admin_login_for_email($1)`, [b.login.email]);
      const found = existing.rows[0];
      if (found && !b.use_existing_login) {
        throw conflict(`${b.login.email} already signs in to ConstructPM as ${found.user_name} at ${found.company_name}.`,
          'login_exists');
      }
      if (found) {
        const already = await c.query(`SELECT 1 FROM factoring_clients WHERE company_id = $1`, [found.company_id]);
        if (already.rows[0]) throw conflict(`${found.company_name} is already a client`, 'already_client');
        const fc = await insertClient(found.company_id);
        await audit(c, {
          platformUserId: req.platform.userId, action: 'create_client', entityType: 'factoring_client',
          entityId: fc.rows[0]!.id, companyId: found.company_id,
          after: { ...b, login: { email: b.login.email }, linked_existing_company: true }, ip: req.ip ?? null,
        });
        return { client_id: fc.rows[0]!.id, company_id: found.company_id, company_name: found.company_name,
                 linked_existing: true, invite: null };
      }
    }

    // One client per business name. (Two different businesses with the same
    // legal name are rare enough to handle by adding a state or DBA.)
    const dup = await c.query<{ name: string }>(
      `SELECT c.name FROM factoring_clients fc JOIN companies c ON c.id = fc.company_id
        WHERE LOWER(BTRIM(c.name)) = LOWER(BTRIM($1)) LIMIT 1`, [b.legal_name]);
    if (dup.rows[0]) throw conflict(`There's already a client named ${dup.rows[0].name}`, 'already_client');

    const co = await c.query<{ id: string }>(`SELECT admin_create_client_company($1) AS id`, [b.legal_name])
      .catch(dbError);
    const companyId = co.rows[0]!.id;
    const fc = await insertClient(companyId);

    let invite: { link: string; email: string; first_name: string } | null = null;
    if (b.login) {
      const u = await c.query<{ id: string }>(
        `SELECT admin_add_client_login($1,$2,$3,$4,$5) AS id`,
        [companyId, b.login.first_name, b.login.last_name, b.login.email, b.login.phone ?? null]).catch(dbError);
      invite = await issueClientInvite(c, companyId, u.rows[0]!.id);
    }

    await audit(c, {
      platformUserId: req.platform.userId, action: 'create_client', entityType: 'factoring_client',
      entityId: fc.rows[0]!.id, companyId,
      after: { ...b, login: b.login ? { email: b.login.email } : null }, ip: req.ip ?? null,
    });
    return { client_id: fc.rows[0]!.id, company_id: companyId, company_name: b.legal_name,
             linked_existing: false, invite };
  });

  if (out.invite && b.send_invite) emailInvite(out.invite.email, out.invite.first_name, out.invite.link, INTRO);
  res.status(201).json({ data: {
    client_id: out.client_id, company_id: out.company_id, company_name: out.company_name,
    linked_existing: out.linked_existing, invite_link: out.invite?.link ?? null,
  } });
}));

// ─── One client ───────────────────────────────────────────────────────────────

async function loadClient(id: string) {
  const r = await pool().query(
    `SELECT fc.*, c.name AS company_name FROM factoring_clients fc
       JOIN companies c ON c.id = fc.company_id WHERE fc.id = $1`, [id]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0] as Record<string, unknown> & { company_id: string };
}

clientsAdminRouter.get('/clients/:id', asyncHandler(async (req, res) => {
  const client = await loadClient(String(req.params['id']));
  const logins = await pool().query(`SELECT * FROM admin_client_logins($1)`, [client.company_id]);
  res.json({ data: { client, logins: logins.rows } });
}));

/** Terms: status, fee schedule, credit limit, onboarding date, notes. */
clientsAdminRouter.patch('/clients/:id',
  validate(z.object({
    status: z.enum(['prospect', 'active', 'suspended', 'closed']).optional(),
    default_fee_schedule_id: z.string().uuid().nullable().optional(),
    credit_limit: z.number().nonnegative().max(1e10).nullable().optional(),
    onboarded_on: isoDate.nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const keys = Object.keys(b);
    if (!keys.length) { res.status(422).json({ error: 'validation_error', message: 'Nothing to change' }); return; }
    const row = await withAdminTransaction(async (c) => {
      const before = await c.query(`SELECT * FROM factoring_clients WHERE id = $1 FOR UPDATE`, [req.params['id']]);
      if (!before.rows[0]) throw notFound();
      if (b['status'] === 'active' && !(b['default_fee_schedule_id'] ?? before.rows[0]['default_fee_schedule_id'])) {
        throw Object.assign(new Error('Choose a fee schedule before making the client active'), { status: 422 });
      }
      const r = await c.query(
        `UPDATE factoring_clients SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
          WHERE id = $1 RETURNING *`, [req.params['id'], ...keys.map((k) => b[k] === '' ? null : b[k])])
        .catch(dbError);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'update_client', entityType: 'factoring_client',
        entityId: String(req.params['id']), companyId: before.rows[0]['company_id'],
        before: before.rows[0], after: r.rows[0], ip: req.ip ?? null,
      });
      return r.rows[0];
    });
    res.json({ data: row });
  }));

// ─── Logins ───────────────────────────────────────────────────────────────────

/** Add someone at the client who can sign in. */
clientsAdminRouter.post('/clients/:id/logins',
  validate(loginSchema.extend({ send_invite: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof loginSchema> & { send_invite: boolean };
    const client = await loadClient(String(req.params['id']));
    const invite = await withAdminTransaction(async (c) => {
      const u = await c.query<{ id: string }>(
        `SELECT admin_add_client_login($1,$2,$3,$4,$5) AS id`,
        [client.company_id, b.first_name, b.last_name, b.email, b.phone ?? null]).catch(dbError);
      const inv = await issueClientInvite(c, client.company_id, u.rows[0]!.id);
      await audit(c, {
        platformUserId: req.platform.userId, action: 'add_client_login', entityType: 'factoring_client',
        entityId: String(req.params['id']), companyId: client.company_id,
        after: { user_id: u.rows[0]!.id, email: b.email }, ip: req.ip ?? null,
      });
      return inv;
    });
    if (b.send_invite) emailInvite(invite.email, invite.first_name, invite.link, INTRO);
    res.status(201).json({ data: { invite_link: invite.link } });
  }));

/** A new set-password link for one of the client's logins (also a password reset). */
clientsAdminRouter.post('/clients/:id/logins/:userId/invite',
  validate(z.object({ send_invite: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const client = await loadClient(String(req.params['id']));
    const invite = await withAdminTransaction(async (c) => {
      const inv = await issueClientInvite(c, client.company_id, String(req.params['userId']));
      await audit(c, {
        platformUserId: req.platform.userId, action: 'client_login_invite', entityType: 'factoring_client',
        entityId: String(req.params['id']), companyId: client.company_id,
        after: { user_id: req.params['userId'] }, ip: req.ip ?? null,
      });
      return inv;
    });
    if ((req.body as { send_invite: boolean }).send_invite) {
      emailInvite(invite.email, invite.first_name, invite.link, INTRO);
    }
    res.json({ data: { invite_link: invite.link } });
  }));
