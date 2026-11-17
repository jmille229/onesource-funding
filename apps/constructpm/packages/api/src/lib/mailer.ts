import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from '../middleware/index.js';

/**
 * Outbound mail.
 *
 * Disabled unless SMTP_HOST is set, and `notify` never throws: a funding request
 * must not fail because a mail server is down. Delivery is best-effort
 * notification on top of state that is already durably recorded, so a failure is
 * logged and swallowed rather than surfaced to the client.
 */
const enabled = Boolean(env.SMTP_HOST && env.SMTP_HOST.trim() !== '');

/**
 * Port 465 is encrypted from the first byte; 587 (and 25/2525) start plain and
 * upgrade with STARTTLS. Setting `secure` the wrong way round for the port makes
 * every send fail, and the old example config did exactly that (587 + secure),
 * so the port decides for the two standard ports. On 587 the upgrade is required:
 * the password is never sent over an unencrypted connection.
 */
export function smtpTls(port: number, secureSetting: boolean): { secure: boolean; requireTLS: boolean } {
  if (port === 465) return { secure: true, requireTLS: false };
  if (port === 587) return { secure: false, requireTLS: true };
  return { secure: secureSetting, requireTLS: false };
}

const transport = enabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      ...smtpTls(env.SMTP_PORT, env.SMTP_SECURE),
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailEnabled = enabled;

export async function notify(opts: { to: string | null; subject: string; text: string }): Promise<void> {
  if (!opts.to) {
    logger.info({ subject: opts.subject },
      'OPS_NOTIFICATION_EMAIL not set — alert not sent');
    return;
  }
  if (!transport) {
    logger.info({ to: opts.to, subject: opts.subject }, 'mail disabled — notification skipped');
    return;
  }
  try {
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
  } catch (err) {
    logger.error({ err, subject: opts.subject }, 'notification email failed');
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

/** True when alerts have somewhere to go. */
export const opsNotificationsEnabled = Boolean(enabled && OPS_INBOX);

/** For the console's "send a test email": like notify, but tells you what went wrong. */
export async function sendTestEmail(to: string): Promise<void> {
  if (!transport) throw Object.assign(new Error('Email isn’t configured on this server (SMTP_HOST is unset).'), { status: 409 });
  await transport.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: 'One Source test email',
    text: 'This is a test from the One Source console. If it arrived, the server can send email.',
  }).catch((err: Error) => {
    throw Object.assign(new Error(`The mail server refused it: ${err.message}`), { status: 502 });
  });
}
