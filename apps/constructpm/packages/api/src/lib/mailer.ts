import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from '../middleware/index.js';
import { writePool } from './db.js';
import { decryptSecret, secretsConfigured } from './secrets.js';
import { GoogleMailError, sendViaGmail, type GoogleClient } from './gmail.js';

/**
 * Outbound mail, by one of two routes:
 *
 * - **Google** (preferred): a Google Workspace mailbox connected from the
 *   console sends through the Gmail API over HTTPS (lib/gmail.ts). Used whenever
 *   GOOGLE_OAUTH_CLIENT_ID/SECRET are set and a mailbox is connected.
 * - **SMTP**: SMTP_HOST and friends, otherwise.
 *
 * `notify` never throws: a funding request must not fail because mail is down.
 * Delivery is best-effort notification on top of state that is already durably
 * recorded, so a failure is logged and swallowed rather than surfaced to the
 * client. The console's test button (`sendTestEmail`) is the one place that
 * reports what went wrong.
 */
const enabled = Boolean(env.SMTP_HOST && env.SMTP_HOST.trim() !== '');

export const googleClient: GoogleClient | null =
  env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
    : null;

/**
 * 465 (and the alternative 2465) are encrypted from the first byte; 587 (and the
 * alternatives 2587 and 2525, which sending services offer because many hosts —
 * DigitalOcean included — block 25/465/587) start plain and upgrade with
 * STARTTLS. Setting `secure` the wrong way round for the port makes every send
 * fail, and the old example config did exactly that (587 + secure), so the port
 * decides for these. On the STARTTLS ports the upgrade is required: the password
 * is never sent over an unencrypted connection.
 */
export function smtpTls(port: number, secureSetting: boolean): { secure: boolean; requireTLS: boolean } {
  if (port === 465 || port === 2465) return { secure: true, requireTLS: false };
  if (port === 587 || port === 2587 || port === 2525) return { secure: false, requireTLS: true };
  return { secure: secureSetting, requireTLS: false };
}

const transport = enabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      ...smtpTls(env.SMTP_PORT, env.SMTP_SECURE),
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      // Fail in seconds, not nodemailer's default two minutes: a blocked port
      // otherwise hangs the console's test button past every timeout above it.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

// ─── The connected Google mailbox ────────────────────────────────────────────
interface GoogleConnection { email: string; refreshTokenEnc: string; status: 'ok' | 'broken'; connectedAt: Date }

async function googleConnection(): Promise<GoogleConnection | null> {
  if (!googleClient) return null;
  const r = await writePool.query<{ email: string; refresh_token: string; status: 'ok' | 'broken'; connected_at: Date }>(
    'SELECT email, refresh_token, status, connected_at FROM mail_google_get()');
  const row = r.rows[0];
  return row ? { email: row.email, refreshTokenEnc: row.refresh_token, status: row.status, connectedAt: row.connected_at } : null;
}

async function recordGoogleResult(c: GoogleConnection, ok: boolean, error?: string, broken = false): Promise<void> {
  await writePool.query('SELECT mail_google_result($1, $2, $3, $4)', [c.connectedAt, ok, error ?? null, broken])
    .catch((err: unknown) => logger.error({ err }, 'could not record the mail result'));
}

export type MailMode = 'google' | 'smtp' | 'off';

/** Which route mail takes right now. */
export async function mailMode(): Promise<MailMode> {
  const g = await googleConnection().catch((err: unknown) => { logger.error({ err }, 'reading the mail connection failed'); return null; });
  if (g) return 'google';
  return transport ? 'smtp' : 'off';
}

/** True when mail should get through: a working Google connection, or SMTP. */
export async function mailReady(): Promise<boolean> {
  const g = await googleConnection().catch(() => null);
  if (g) return g.status === 'ok';
  return Boolean(transport);
}

const notConfigured = () => Object.assign(
  new Error('Email isn’t set up on this server: connect a Google mailbox in the System tab, or set SMTP_HOST.'),
  { status: 409 });

/** Sends one message by whichever route is set up. Throws on failure. */
async function deliver(m: { to: string; subject: string; text: string }): Promise<'google' | 'smtp'> {
  const g = await googleConnection();
  if (g && googleClient) {
    try {
      if (!secretsConfigured) throw new GoogleMailError('APPLICATION_DATA_KEY isn’t set, so the stored Google permission can’t be read.', 'config');
      await sendViaGmail(googleClient, { refreshToken: decryptSecret(g.refreshTokenEnc), key: g.connectedAt.toISOString() },
                         { from: env.EMAIL_FROM, ...m });
    } catch (err) {
      const message = err instanceof GoogleMailError ? err.message : (err as Error).message;
      await recordGoogleResult(g, false, message, err instanceof GoogleMailError && err.kind === 'disconnected');
      throw err;
    }
    await recordGoogleResult(g, true);
    return 'google';
  }
  if (!transport) throw notConfigured();
  await transport.sendMail({ from: env.EMAIL_FROM, ...m });
  return 'smtp';
}

export async function notify(opts: { to: string | null; subject: string; text: string }): Promise<void> {
  if (!opts.to) {
    logger.info({ subject: opts.subject },
      'OPS_NOTIFICATION_EMAIL not set — alert not sent');
    return;
  }
  try {
    await deliver({ to: opts.to, subject: opts.subject, text: opts.text });
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      logger.info({ to: opts.to, subject: opts.subject }, 'mail not set up — notification skipped');
    } else {
      logger.error({ err, subject: opts.subject }, 'notification email failed');
    }
  }
}

/**
 * Where operator-facing alerts go.
 *
 * Explicitly configured, not derived. This previously fell back to
 * `SMTP_USER || EMAIL_FROM`, and both are wrong destinations: SMTP_USER is an
 * auth username (an AKIA-style key on SES, not a mailbox), and EMAIL_FROM is a
 * noreply address. Alerts would have been delivered nowhere useful.
 */
export const OPS_INBOX = env.OPS_NOTIFICATION_EMAIL ?? null;


/**
 * What went wrong with a send, in words an operator can act on. Only the
 * console's test button shows this; nodemailer's messages carry the server's
 * reply (e.g. "535 5.7.8 Username and Password not accepted"), never the password.
 */
export function describeMailError(err: { code?: string; message?: string; responseCode?: number; response?: string },
                                  host: string, port: number): string {
  const reply = (err.response ?? err.message ?? '').trim();
  switch (err.code) {
    case 'ETIMEDOUT':
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
      if (/timed? ?out|ETIMEDOUT/i.test(err.message ?? '') || err.code === 'ETIMEDOUT') {
        return `No answer from ${host} on port ${port}. Many hosts, DigitalOcean included, block outgoing mail ports — see DEPLOY.md → Email for a sending service on port 2587.`;
      }
      if (/ECONNREFUSED/.test(err.message ?? '')) return `${host} refused the connection on port ${port}. Check SMTP_HOST and SMTP_PORT.`;
      if (/ENOTFOUND|EAI_AGAIN/.test(err.message ?? '') || err.code === 'EDNS') return `Couldn't find ${host}. Check SMTP_HOST.`;
      return `Couldn't connect to ${host} on port ${port}: ${err.message ?? 'connection failed'}`;
    case 'EAUTH':
      return `${host} rejected the username or password (SMTP_USER / SMTP_PASS): ${reply}`;
    case 'EENVELOPE':
      return `${host} won't send from or to that address (check EMAIL_FROM is allowed for this account): ${reply}`;
    default:
      if (err.responseCode && err.responseCode >= 500) return `${host} refused it: ${reply}`;
      return `Sending failed: ${err.message ?? 'unknown error'}`;
  }
}

/** For the console's "send a test email": like notify, but tells you what went wrong. */
export async function sendTestEmail(to: string): Promise<'google' | 'smtp'> {
  try {
    return await deliver({
      to,
      subject: 'One Source test email',
      text: 'This is a test from the One Source console. If it arrived, the server can send email.',
    });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string; responseCode?: number; response?: string };
    if (err.status === 409) throw err;
    logger.warn({ err }, 'test email failed');
    // 424, not 5xx: production hides 5xx messages, and this one is the point.
    const message = err instanceof GoogleMailError ? err.message : describeMailError(err, env.SMTP_HOST ?? '', env.SMTP_PORT);
    throw Object.assign(new Error(message), { status: 424, code: 'mail_failed' });
  }
}
