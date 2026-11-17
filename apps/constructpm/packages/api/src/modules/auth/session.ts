import type { Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { readPool, withTransaction } from '../../lib/db.js';
import { signAccessToken, signMfaChallenge } from '../../lib/jwt.js';
import type { UserRole } from '@constructpm/shared';

/** Sessions for client logins: shared by sign-in, invites, resets and two-step sign-in. */
export const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  maxAge: 90 * 86400 * 1000,
  path: '/api/auth',
};

/**
 * Issues a complete session: a 15-minute access token in the body and a
 * 90-day rotating refresh token in an httpOnly cookie.
 *
 * Login and register both go through here. Register used to return only the
 * access token — no cookie — so a brand-new tenant was silently logged out
 * fifteen minutes after signing up, with nothing for the SPA's silent refresh
 * to fall back on. One code path means one set of session semantics.
 */
export async function issueSession(
  res: Response,
  user: { id: string; company_id: string; role: UserRole }
): Promise<string> {
  const accessToken = signAccessToken({ userId: user.id, companyId: user.company_id, role: user.role });

  const rawRefresh = randomUUID() + randomUUID();
  const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
  const familyId = randomUUID();
  const expiry = new Date(Date.now() + 90 * 86400 * 1000);

  // Writes are scoped to the user's own company so the RLS WITH CHECK passes.
  await withTransaction(user.company_id, async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, absolute_expiry)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.company_id, user.id, tokenHash, familyId, expiry]
    );
    await client.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  });

  res.cookie('refresh_token', rawRefresh, COOKIE_OPTS);
  return accessToken;
}

export interface SignInUser {
  id: string; company_id: string; role: UserRole; email: string; first_name: string; last_name: string;
}

/** A full session: the cookie is set, and this is the response body's data. */
export async function sessionResponse(res: Response, user: SignInUser) {
  const accessToken = await issueSession(res, user);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 900,
    user: {
      id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name,
      role: user.role, company_id: user.company_id,
    },
  };
}

/**
 * The password (or an emailed link) checked out: finish signing in, or — if
 * the person uses two-step sign-in, or their company requires it — hand back a
 * short-lived challenge instead of a session. Every way into an account goes
 * through here, so none of them skips the second step.
 */
export async function completeSignIn(res: Response, user: SignInUser) {
  const st = (await readPool.query<{ mfa_enabled: boolean; required: boolean }>(
    `SELECT mfa_enabled, required FROM auth_mfa_state($1)`, [user.id])).rows[0];
  if (st?.mfa_enabled) {
    return { mfa_required: true, challenge: signMfaChallenge({ sub: user.id, kind: 'tenant', purpose: 'verify' }) };
  }
  if (st?.required) {
    return { mfa_setup_required: true, challenge: signMfaChallenge({ sub: user.id, kind: 'tenant', purpose: 'setup' }) };
  }
  return sessionResponse(res, user);
}

