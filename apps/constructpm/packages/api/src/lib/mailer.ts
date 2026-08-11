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

const transport = enabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailEnabled = enabled;

export async function notify(opts: { to: string; subject: string; text: string }): Promise<void> {
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

/** Where operator-facing alerts go. Falls back to EMAIL_FROM if unset. */
export const OPS_INBOX = env.SMTP_USER || env.EMAIL_FROM;
