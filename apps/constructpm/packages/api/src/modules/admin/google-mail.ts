import { Router, type Request } from 'express';
import { randomBytes } from 'crypto';
import { env } from '../../lib/env.js';
import { adminPool, withAdminTransaction, audit } from '../../lib/admin-db.js';
import { encryptSecret, decryptSecret, secretsConfigured } from '../../lib/secrets.js';
import { googleClient, mailMode, OPS_INBOX } from '../../lib/mailer.js';
import { consentUrl, exchangeCode, forgetAccessToken, pkcePair, revoke, GoogleMailError } from '../../lib/gmail.js';
import { asyncHandler, authRateLimit, logger } from '../../middleware/index.js';

/**
 * Connecting the Google mailbox the app sends from (see lib/gmail.ts).
 *
 * 1. An operator presses Connect in the System tab: POST /api/admin/system/google/connect
 *    returns Google's consent address, opened in a small window.
 * 2. They sign in as the mailbox and allow "send email on your behalf".
 * 3. Google sends the browser to /api/mail/google/callback, which swaps the code
 *    for a lasting permission, stores it encrypted, and says "connected". The
 *    console, polling the status, updates on its own.
 *
 * The callback can't carry the operator's sign-in (that lives in the console
 * tab's memory), so the `state` Google hands back is a single-use, ten-minute
 * value issued only to a signed-in operator, and the PKCE verifier never leaves
 * the server.
 */

export const redirectUri = () => `${env.APP_URL.replace(/\/+$/, '')}/api/mail/google/callback`;

const pending = new Map<string, { verifier: string; operatorId: string; expires: number }>();
const TEN_MINUTES = 10 * 60_000;
function prune() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// ─── Status (for GET /api/admin/system) ──────────────────────────────────────
export async function emailStatus() {
  let connection: null | {
    email: string; status: 'ok' | 'broken'; last_error: string | null; last_error_at: string | null;
    last_sent_at: string | null; connected_at: string; connected_by: string | null;
  } = null;
  if (googleClient && adminPool) {
    connection = (await adminPool.query('SELECT * FROM mail_google_status()')).rows[0] ?? null;
  }
  const mode = await mailMode();
  const smtpHost = env.SMTP_HOST && env.SMTP_HOST.trim() !== '' ? env.SMTP_HOST : null;
  return {
    mode,
    ready: mode === 'google' ? connection?.status === 'ok' : mode === 'smtp',
    from: env.EMAIL_FROM,
    ops_inbox: OPS_INBOX,
    smtp: smtpHost ? { host: smtpHost, port: env.SMTP_PORT } : null,
    google: {
      configured: Boolean(googleClient),
      can_connect: Boolean(googleClient && secretsConfigured),
      redirect_uri: redirectUri(),
      connection,
    },
  };
}

// ─── Operator routes (mounted behind operator sign-in) ───────────────────────
export const googleMailAdminRouter = Router();

googleMailAdminRouter.post('/system/google/connect', asyncHandler(async (req, res) => {
  if (!googleClient) throw fail(409, 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.production first (DEPLOY.md → Email).');
  if (!secretsConfigured) throw fail(409, 'Set APPLICATION_DATA_KEY first: the permission is stored encrypted with it.');
  prune();
  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkcePair();
  pending.set(state, { verifier, operatorId: req.platform.userId, expires: Date.now() + TEN_MINUTES });
  res.json({ data: { url: consentUrl({ clientId: googleClient.clientId, redirectUri: redirectUri(), state, challenge }) } });
}));

googleMailAdminRouter.post('/system/google/disconnect', asyncHandler(async (req, res) => {
  const old = await withAdminTransaction(async (c) => {
    const r = await c.query<{ email: string; refresh_token: string }>('SELECT * FROM mail_google_clear()');
    if (r.rows[0]) {
      await audit(c, { platformUserId: req.platform.userId, action: 'disconnect_google_mail', entityType: 'mail_connection',
                       before: { email: r.rows[0].email }, ip: req.ip ?? null });
    }
    return r.rows[0] ?? null;
  });
  forgetAccessToken();
  // Tell Google too, so the permission doesn't linger in the account.
  let revoked = false;
  if (old && secretsConfigured) {
    try { revoked = await revoke(decryptSecret(old.refresh_token)); } catch { /* the row is gone either way */ }
  }
  res.json({ data: { disconnected: Boolean(old), revoked } });
}));

// ─── Google's redirect back (public: no console sign-in on this request) ─────
export const mailOAuthRouter = Router();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(res: import('express').Response, status: number, title: string, body: string) {
  res.status(status)
    .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">${esc(title)}</h1><p>${body}</p>
<p style="color:#64748b">You can close this window and go back to the console.</p></body></html>`);
}

mailOAuthRouter.get('/google/callback', authRateLimit, asyncHandler(async (req: Request, res) => {
  const q = req.query as Record<string, string | undefined>;
  const flow = q['state'] ? pending.get(q['state']) : undefined;
  if (q['state']) pending.delete(q['state']); // single use, whatever happens next
  if (q['error']) {
    page(res, 400, 'Not connected', q['error'] === 'access_denied'
      ? 'Permission wasn’t given, so nothing changed.'
      : `Google said: ${esc(q['error'])}. Nothing changed.`);
    return;
  }
  if (!flow || flow.expires < Date.now() || !q['code']) {
    page(res, 400, 'This link has expired', 'Start again from the console’s System tab (Connect Google mailbox).');
    return;
  }
  if (!googleClient || !secretsConfigured) {
    page(res, 409, 'Not connected', 'Google sign-in isn’t set up on this server any more.');
    return;
  }
  try {
    const got = await exchangeCode(googleClient, { code: q['code'], verifier: flow.verifier, redirectUri: redirectUri() });
    await withAdminTransaction(async (c) => {
      await c.query('SELECT mail_google_save($1, $2, $3, $4)',
        [got.email, encryptSecret(got.refreshToken), got.scopes.join(' '), flow.operatorId]);
      await audit(c, { platformUserId: flow.operatorId, action: 'connect_google_mail', entityType: 'mail_connection',
                       after: { email: got.email, scopes: got.scopes }, ip: req.ip ?? null });
    });
    forgetAccessToken();
    page(res, 200, 'Connected', `One Source will send its email through <strong>${esc(got.email)}</strong>. `
      + 'Use “Send me a test” in the System tab to check.');
  } catch (err) {
    logger.warn({ err }, 'connecting the Google mailbox failed');
    page(res, err instanceof GoogleMailError && err.kind === 'config' ? 409 : 400, 'Not connected',
      esc(err instanceof GoogleMailError ? err.message : 'Something went wrong. Try again from the System tab.'));
  }
}));
