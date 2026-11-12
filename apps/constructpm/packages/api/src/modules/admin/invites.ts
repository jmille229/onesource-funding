import { createHash, randomBytes } from 'crypto';
import { env } from '../../lib/env.js';
import { notify } from '../../lib/mailer.js';

/**
 * Set-password links for client logins, shared by application approval and
 * the console's manual client setup. Only the token's SHA-256 is stored; the
 * link carries it in the fragment, so it never reaches a server log.
 */
export const INVITE_TTL_DAYS = 14;

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

export const inviteLink = (token: string) =>
  `${env.APP_URL.replace(/\/+$/, '')}/accept-invite#token=${token}`;

/** Email the link (best effort — the console always shows it to copy as well). */
export function emailInvite(to: string, firstName: string, link: string, intro: string) {
  void notify({
    to,
    subject: 'Your One Source Funding account is ready',
    text: `Hi ${firstName},\n\n${intro}\n\n`
        + `Set your password here to sign in, submit invoices for funding and follow every advance:\n`
        + `${link}\n\nThe link works once and expires in ${INVITE_TTL_DAYS} days.\n\nOne Source Funding`,
  });
}
