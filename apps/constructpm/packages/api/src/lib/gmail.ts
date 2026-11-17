import { createHash, randomBytes } from 'crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

/**
 * Sending through a Google Workspace mailbox with the Gmail API.
 *
 * Why not SMTP: some hosts (DigitalOcean among them) block outgoing mail ports,
 * so smtp.gmail.com is unreachable; the Gmail API is ordinary HTTPS. And the
 * permission is narrower: `gmail.send` lets the app send as the connected
 * mailbox and nothing else, where an app password also opens the whole mailbox
 * to IMAP.
 *
 * The OAuth client is the company's own ("Internal" in Google Cloud), so no
 * Google review is needed and refresh tokens don't expire on a timer. Google
 * does cancel a refresh token that carries a Gmail scope when the account's
 * password changes; that shows up here as `disconnected`, and the console
 * offers Reconnect.
 *
 * Plain fetch against Google's documented endpoints: no SDK dependency.
 */

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TIMEOUT_MS = 15_000;

export type GoogleMailErrorKind = 'disconnected' | 'config' | 'refused' | 'unreachable';

export class GoogleMailError extends Error {
  constructor(message: string, readonly kind: GoogleMailErrorKind) {
    super(message);
    this.name = 'GoogleMailError';
  }
}

export interface GoogleClient { clientId: string; clientSecret: string }

// ─── Connecting ──────────────────────────────────────────────────────────────

/** PKCE (RFC 7636): the verifier stays on the server; Google sees only its hash. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function consentUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',          // a refresh token, to send without anyone signed in
    prompt: 'consent select_account', // always issue one, and let them pick the mailbox
    include_granted_scopes: 'false',
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

async function post(url: string, body: URLSearchParams | string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const why = (err as Error).name === 'TimeoutError' ? 'no answer within 15 seconds' : (err as Error).message;
    throw new GoogleMailError(`Couldn't reach Google (${why}).`, 'unreachable');
  }
}

async function oauthError(r: Response): Promise<{ error: string; description: string }> {
  const b = await r.json().catch(() => ({})) as { error?: string; error_description?: string };
  return { error: b.error ?? `http_${r.status}`, description: b.error_description ?? '' };
}

/**
 * The address the consent was given for, from the ID token. It came straight
 * from Google's token endpoint over TLS, which is what OpenID Connect allows in
 * place of checking its signature.
 */
export function emailFromIdToken(idToken: string): { email: string; verified: boolean; domain: string | null } {
  const part = idToken.split('.')[1];
  if (!part) throw new GoogleMailError('Google sent an unreadable sign-in token.', 'refused');
  const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as
    { email?: string; email_verified?: boolean; hd?: string };
  if (!claims.email) throw new GoogleMailError('Google didn’t say which mailbox was connected.', 'refused');
  return { email: claims.email.toLowerCase(), verified: claims.email_verified === true, domain: claims.hd ?? null };
}

/** Swaps the one-time code from the consent screen for a refresh token. */
export async function exchangeCode(c: GoogleClient, o: { code: string; verifier: string; redirectUri: string }):
  Promise<{ refreshToken: string; email: string; scopes: string[] }> {
  const r = await post(TOKEN_URL, new URLSearchParams({
    client_id: c.clientId, client_secret: c.clientSecret, code: o.code, code_verifier: o.verifier,
    redirect_uri: o.redirectUri, grant_type: 'authorization_code',
  }), { 'Content-Type': 'application/x-www-form-urlencoded' });
  if (!r.ok) {
    const e = await oauthError(r);
    if (e.error === 'invalid_client' || e.error === 'unauthorized_client') {
      throw new GoogleMailError('Google doesn’t accept GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Check them in .env.production.', 'config');
    }
    if (e.error === 'redirect_uri_mismatch') {
      throw new GoogleMailError(`The redirect address isn’t on the Google OAuth client. Add ${o.redirectUri} under “Authorized redirect URIs”.`, 'config');
    }
    throw new GoogleMailError(`Google refused the connection: ${e.error}${e.description ? ` (${e.description})` : ''}`, 'refused');
  }
  const b = await r.json() as { refresh_token?: string; id_token?: string; scope?: string };
  const scopes = (b.scope ?? '').split(/\s+/).filter(Boolean);
  // Google's consent screen lets people untick individual permissions.
  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new GoogleMailError('The “Send email on your behalf” permission wasn’t ticked. Connect again and allow it.', 'refused');
  }
  if (!b.refresh_token) throw new GoogleMailError('Google didn’t issue a lasting permission. Connect again.', 'refused');
  if (!b.id_token) throw new GoogleMailError('Google didn’t say which mailbox was connected.', 'refused');
  return { refreshToken: b.refresh_token, email: emailFromIdToken(b.id_token).email, scopes };
}

/** Best effort: tells Google to drop the permission. */
export async function revoke(token: string): Promise<boolean> {
  try {
    const r = await post(REVOKE_URL, new URLSearchParams({ token }), { 'Content-Type': 'application/x-www-form-urlencoded' });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

// Access tokens last an hour. Keyed by the connection, so a reconnect starts fresh.
let cached: { key: string; token: string; expiresAt: number } | null = null;
export function forgetAccessToken(): void { cached = null; }

async function accessToken(c: GoogleClient, refreshToken: string, key: string): Promise<string> {
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const r = await post(TOKEN_URL, new URLSearchParams({
    client_id: c.clientId, client_secret: c.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }), { 'Content-Type': 'application/x-www-form-urlencoded' });
  if (!r.ok) {
    const e = await oauthError(r);
    if (e.error === 'invalid_grant') {
      throw new GoogleMailError('Google cancelled the permission to send (usually a password change, or access removed in the Google account). Reconnect it in the console’s System tab.', 'disconnected');
    }
    if (e.error === 'invalid_client' || e.error === 'unauthorized_client') {
      throw new GoogleMailError('Google doesn’t accept GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Check them in .env.production.', 'config');
    }
    throw new GoogleMailError(`Google wouldn’t issue an access token: ${e.error}${e.description ? ` (${e.description})` : ''}`, 'refused');
  }
  const b = await r.json() as { access_token: string; expires_in?: number };
  cached = { key, token: b.access_token, expiresAt: Date.now() + (b.expires_in ?? 3600) * 1000 };
  return b.access_token;
}

export interface OutgoingMail { from: string; to: string; subject: string; text: string; replyTo?: string }

/** The message as Gmail wants it: RFC 5322, base64url. */
export async function rawMessage(m: OutgoingMail): Promise<string> {
  const buf = await new MailComposer({ from: m.from, to: m.to, subject: m.subject, text: m.text, replyTo: m.replyTo })
    .compile().build();
  return buf.toString('base64url');
}

/**
 * Sends one message as the connected mailbox. Gmail keeps the From address if
 * it's the mailbox or one of its "Send mail as" addresses, and otherwise
 * replaces it with the mailbox's own.
 */
export async function sendViaGmail(c: GoogleClient, conn: { refreshToken: string; key: string }, m: OutgoingMail): Promise<void> {
  const raw = await rawMessage(m);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(c, conn.refreshToken, conn.key);
    const r = await post(SEND_URL, JSON.stringify({ raw }), {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
    });
    if (r.ok) return;
    // An access token can be revoked before it expires: get a new one, once.
    if (r.status === 401 && attempt === 0) { forgetAccessToken(); continue; }
    const b = await r.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
    const msg = b.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 401) throw new GoogleMailError(`Google refused the permission to send: ${msg}. Reconnect it in the System tab.`, 'disconnected');
    if (r.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
      throw new GoogleMailError('The Gmail API isn’t turned on in the Google Cloud project. APIs & Services → Library → Gmail API → Enable.', 'config');
    }
    throw new GoogleMailError(`Google refused the message: ${msg}`, 'refused');
  }
}
