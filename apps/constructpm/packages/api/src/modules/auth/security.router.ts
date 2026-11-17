import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { readPool, writePool, createRlsClient } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { notify, mailEnabled } from '../../lib/mailer.js';
import { decryptSecret, encryptSecret, secretsConfigured } from '../../lib/secrets.js';
import { verifyMfaChallenge } from '../../lib/jwt.js';
import {
  newTotpSecret, otpauthUri, verifyTotp, newRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode,
} from '../../lib/mfa.js';
import {
  asyncHandler, authenticate, authRateLimit, consumeEmailSend, consumeMfaAttempt, logger, refreshRateLimit, validate,
} from '../../middleware/index.js';
import { sessionResponse, type SignInUser } from './session.js';

/**
 * Account security, for client logins:
 *
 * Code checks are limited per account (consumeMfaAttempt), not just per IP:
 * the per-IP login limit stays for passwords, and a second-step request uses
 * the looser per-IP limit so an office behind one address can still sign in.
 *
 *   Password reset       POST /password/forgot  → emailed one-time link (1 hour).
 *                        The link is redeemed through /invite/accept (same
 *                        table and rules), so it signs in through the same
 *                        two-step check as everything else.
 *   Email verification   POST /email/verify, /email/verify/resend
 *   Two-step sign-in     /mfa/* — finishing a sign-in that needs a code, and
 *                        turning it on or off for yourself.
 *
 * Mounted at /api/auth alongside the auth router.
 */
export const securityRouter = Router();

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const ISSUER = 'One Source';
const ARGON2_OPTS: argon2.Options & { raw?: false } = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, code });

function requireSecrets() {
  if (!secretsConfigured) throw fail(503, 'Two-step sign-in isn’t available on this server yet (no encryption key).');
}

// ─── Password reset ───────────────────────────────────────────────────────────

securityRouter.post('/password/forgot', authRateLimit,
  validate(z.object({ email: z.string().email().max(254) })),
  asyncHandler(async (req, res) => {
    const email = (req.body as { email: string }).email.trim();
    // Same answer, same speed, whether or not the address has an account: the
    // lookup and the email happen after the response.
    res.json({ data: { sent: true } });
    if (!(await consumeEmailSend(`reset:${email}`))) return;
    try {
      const token = newToken();
      const r = await writePool.query<{ email: string; first_name: string }>(
        `SELECT * FROM auth_request_password_reset($1, $2)`, [email, hash(token)]);
      const u = r.rows[0];
      if (!u) return;
      if (!mailEnabled) logger.warn('password reset requested but email is not configured — link not sent');
      await notify({
        to: u.email,
        subject: 'Reset your One Source password',
        text: `Hi ${u.first_name},\n\nSomeone asked to reset the password for your account. If it was you, `
            + `set a new one with this link (it works once, for the next hour):\n\n`
            + `${env.APP_URL}/reset-password#token=${token}\n\n`
            + `If you didn't ask, you can ignore this email — your password hasn't changed.`,
      });
    } catch (err) {
      logger.error({ err }, 'password reset failed');
    }
  }));

// ─── Email verification ───────────────────────────────────────────────────────

/** Email a verification link to a new account (no-op if verified or just sent). */
export async function sendVerificationEmail(userId: string): Promise<void> {
  const token = newToken();
  const r = await writePool.query<{ email: string; first_name: string }>(
    `SELECT * FROM auth_create_email_verification($1, $2)`, [userId, hash(token)]);
  const u = r.rows[0];
  if (!u) return;
  await notify({
    to: u.email,
    subject: 'Confirm your email for One Source',
    text: `Hi ${u.first_name},\n\nConfirm this is your email address:\n\n`
        + `${env.APP_URL}/verify-email#token=${token}\n\n`
        + `The link works for 7 days. If you didn't create an account, ignore this email.`,
  });
}

securityRouter.post('/email/verify', refreshRateLimit,
  validate(z.object({ token: z.string().min(20).max(200) })),
  asyncHandler(async (req, res) => {
    const r = await writePool.query(`SELECT * FROM auth_verify_email($1)`, [hash((req.body as { token: string }).token)]);
    if (!r.rows[0]) throw fail(404, 'This link has expired or was already used.', 'invalid_link');
    res.json({ data: { verified: true } });
  }));

securityRouter.post('/email/verify/resend', authenticate, asyncHandler(async (req, res) => {
  if (!(await consumeEmailSend(`verify:${req.auth.userId}`))) throw fail(429, 'Too many emails sent. Try again later.');
  if (!mailEnabled) throw fail(503, 'Email isn’t set up on this server yet.');
  await sendVerificationEmail(req.auth.userId);
  res.json({ data: { sent: true } });
}));

// ─── Two-step sign-in: finishing a sign-in ────────────────────────────────────

interface MfaState { mfa_enabled: boolean; mfa_secret: string | null; required: boolean; recovery_left: number }
const mfaState = async (userId: string) =>
  (await readPool.query<MfaState>(`SELECT * FROM auth_mfa_state($1)`, [userId])).rows[0];

async function signInUser(userId: string): Promise<SignInUser> {
  const u = await readPool.query<SignInUser>(
    `SELECT id, company_id, email, first_name, last_name, role FROM auth_find_user_by_id($1)`, [userId]);
  if (!u.rows[0]) throw fail(401, 'Sign in again.', 'invalid_challenge');
  return u.rows[0];
}

/** Check a code (or a recovery code) for a user with two-step sign-in on. */
async function checkSecondStep(userId: string, code: string, secretEncrypted: string | null): Promise<boolean> {
  if (looksLikeRecoveryCode(code)) {
    const r = await writePool.query<{ ok: boolean }>(`SELECT auth_mfa_use_recovery($1, $2) AS ok`, [userId, hashRecoveryCode(code)]);
    return r.rows[0]!.ok;
  }
  if (!secretEncrypted) return false;
  const step = verifyTotp(decryptSecret(secretEncrypted), code);
  if (step === null) return false;
  const r = await writePool.query<{ ok: boolean }>(`SELECT auth_mfa_use_step($1, $2) AS ok`, [userId, step]);
  return r.rows[0]!.ok;   // false = this code was already used
}

const challengeBody = z.object({ challenge: z.string().min(20).max(2000) });
const codeBody = challengeBody.extend({ code: z.string().trim().min(6).max(20) });

function readChallenge(token: string, purpose: 'verify' | 'setup') {
  try {
    const c = verifyMfaChallenge(token, 'tenant');
    if (c.purpose !== purpose) throw new Error('wrong purpose');
    return c;
  } catch {
    throw fail(401, 'That sign-in took too long. Sign in again.', 'invalid_challenge');
  }
}

securityRouter.post('/mfa/verify', refreshRateLimit, validate(codeBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof codeBody>;
  const c = readChallenge(b.challenge, 'verify');
  if (!(await consumeMfaAttempt(`u:${c.sub}`))) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
  const st = await mfaState(c.sub);
  if (!st?.mfa_enabled) throw fail(401, 'Sign in again.', 'invalid_challenge');
  if (!(await checkSecondStep(c.sub, b.code, st.mfa_secret))) throw fail(401, 'That code didn’t work. Check your authenticator app and try again.', 'invalid_code');
  logger.info({ user_id: c.sub }, 'Two-step sign-in passed');
  res.json({ data: await sessionResponse(res, await signInUser(c.sub)) });
}));

/** Enrolling during sign-in (the company requires it). Step 1: a new secret. */
securityRouter.post('/mfa/setup/start', refreshRateLimit, validate(challengeBody), asyncHandler(async (req, res) => {
  requireSecrets();
  const c = readChallenge((req.body as { challenge: string }).challenge, 'setup');
  const user = await signInUser(c.sub);
  res.json({ data: await beginEnrolment(user.id, user.email) });
}));

/** Step 2: the first code proves it works; sign-in completes. */
securityRouter.post('/mfa/setup/finish', refreshRateLimit, validate(codeBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof codeBody>;
  const c = readChallenge(b.challenge, 'setup');
  if (!(await consumeMfaAttempt(`u:${c.sub}`))) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
  const recovery_codes = await finishEnrolment(c.sub, b.code);
  res.json({ data: { ...(await sessionResponse(res, await signInUser(c.sub))), recovery_codes } });
}));

async function beginEnrolment(userId: string, email: string) {
  requireSecrets();
  const secret = newTotpSecret();
  await writePool.query(`SELECT auth_mfa_begin($1, $2)`, [userId, encryptSecret(secret)]);
  return { secret, otpauth_uri: otpauthUri(secret, email, ISSUER) };
}

async function finishEnrolment(userId: string, code: string): Promise<string[]> {
  const pending = (await readPool.query<{ s: string | null }>(`SELECT auth_mfa_pending_secret($1) AS s`, [userId])).rows[0]?.s;
  if (!pending) throw fail(409, 'Start setting up two-step sign-in again.', 'no_pending_setup');
  const step = verifyTotp(decryptSecret(pending), code);
  if (step === null) throw fail(401, 'That code didn’t work. Check the time on your phone and try again.', 'invalid_code');
  const codes = newRecoveryCodes();
  const ok = (await writePool.query<{ ok: boolean }>(`SELECT auth_mfa_enable($1, $2, $3) AS ok`,
    [userId, step, codes.map(hashRecoveryCode)])).rows[0]!.ok;
  if (!ok) throw fail(409, 'Two-step sign-in is already on.', 'already_enabled');
  logger.info({ user_id: userId }, 'Two-step sign-in turned on');
  return codes;
}

// ─── Two-step sign-in: your own settings ──────────────────────────────────────

securityRouter.get('/mfa', authenticate, asyncHandler(async (req, res) => {
  const st = await mfaState(req.auth.userId);
  res.json({ data: { enabled: Boolean(st?.mfa_enabled), required: Boolean(st?.required), recovery_left: st?.recovery_left ?? 0,
                     available: secretsConfigured } });
}));

securityRouter.post('/mfa/enroll/start', authenticate, asyncHandler(async (req, res) => {
  const st = await mfaState(req.auth.userId);
  if (st?.mfa_enabled) throw fail(409, 'Two-step sign-in is already on.', 'already_enabled');
  const me = await createRlsClient(readPool, req.auth.companyId).query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`, [req.auth.userId]);
  res.json({ data: await beginEnrolment(req.auth.userId, me.rows[0]!.email) });
}));

securityRouter.post('/mfa/enroll/finish', authenticate, validate(z.object({ code: z.string().trim().min(6).max(12) })),
  asyncHandler(async (req, res) => {
    if (!(await consumeMfaAttempt(`u:${req.auth.userId}`))) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
    res.json({ data: { recovery_codes: await finishEnrolment(req.auth.userId, (req.body as { code: string }).code) } });
  }));

/** Turning it off takes the password and a current code, and isn't allowed where the company requires it. */
securityRouter.post('/mfa/disable', authenticate,
  validate(z.object({ password: z.string().min(1).max(1024), code: z.string().trim().min(6).max(20) })),
  asyncHandler(async (req, res) => {
    const b = req.body as { password: string; code: string };
    if (!(await consumeMfaAttempt(`u:${req.auth.userId}`))) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
    const st = await mfaState(req.auth.userId);
    if (!st?.mfa_enabled) throw fail(409, 'Two-step sign-in is already off.');
    if (st.required) throw fail(409, 'Your company requires two-step sign-in, so it can’t be turned off.', 'required');
    const me = await readPool.query<{ password_hash: string }>(`SELECT password_hash FROM auth_find_user_by_id($1)`, [req.auth.userId]);
    const okPassword = me.rows[0] && await argon2.verify(me.rows[0].password_hash, b.password, ARGON2_OPTS).catch(() => false);
    if (!okPassword || !(await checkSecondStep(req.auth.userId, b.code, st.mfa_secret))) {
      throw fail(401, 'The password or code didn’t match.', 'invalid_code');
    }
    await writePool.query(`SELECT auth_mfa_disable($1)`, [req.auth.userId]);
    logger.info({ user_id: req.auth.userId }, 'Two-step sign-in turned off');
    res.json({ data: { enabled: false } });
  }));

securityRouter.post('/mfa/recovery-codes', authenticate, validate(z.object({ code: z.string().trim().min(6).max(20) })),
  asyncHandler(async (req, res) => {
    if (!(await consumeMfaAttempt(`u:${req.auth.userId}`))) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
    const st = await mfaState(req.auth.userId);
    if (!st?.mfa_enabled) throw fail(409, 'Turn on two-step sign-in first.');
    if (!(await checkSecondStep(req.auth.userId, (req.body as { code: string }).code, st.mfa_secret))) {
      throw fail(401, 'That code didn’t work.', 'invalid_code');
    }
    const codes = newRecoveryCodes();
    await writePool.query(`SELECT auth_mfa_new_recovery($1, $2)`, [req.auth.userId, codes.map(hashRecoveryCode)]);
    res.json({ data: { recovery_codes: codes } });
  }));
