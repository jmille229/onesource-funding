import { Router, type Response } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { randomUUID, createHash } from 'crypto';
import { readPool, writePool, withTransaction, createRlsClient } from '../../lib/db.js';
import { signAccessToken } from '../../lib/jwt.js';
import {
  asyncHandler, authRateLimit, refreshRateLimit, authenticate, validate, logger,
} from '../../middleware/index.js';
import type { UserRole } from '@constructpm/shared';

export const authRouter = Router();

const ARGON2_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const COOKIE_OPTS = {
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
async function issueSession(
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

// POST /api/auth/login
authRouter.post(
  '/login',
  authRateLimit,
  validate(z.object({ email: z.string().email(), password: z.string().min(1).max(1024) })),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    // Login has no tenant context yet, so it must look the user up across all
    // tenants. auth_find_user_by_email is a SECURITY DEFINER function — the only
    // cross-tenant read path granted to the RLS-scoped app role.
    const userRes = await readPool.query(`SELECT * FROM auth_find_user_by_email($1)`, [email]);
    const user = userRes.rows[0] as
      | (Record<string, unknown> & { password_hash: string })
      | undefined;

    let valid = false;

    if (user?.['password_hash']) {
      // SECURITY: Single code path — argon2id only. No bcrypt bypass, no demo backdoors.
      const hash = String(user['password_hash']);
      if (hash.startsWith('$argon2')) {
        valid = await argon2.verify(hash, password, ARGON2_OPTS);
      }
      // Any other hash format is rejected — forces re-seeding with argon2
    } else {
      // Timing-safe: hash the password even on miss to prevent user enumeration
      await argon2.hash(password, ARGON2_OPTS).catch(() => {});
    }

    if (!user || !valid) {
      // Same message for both "no user" and "wrong password" — prevents enumeration
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    const accessToken = await issueSession(res, {
      id: String(user['id']),
      company_id: String(user['company_id']),
      role: user['role'] as UserRole,
    });

    logger.info({ user_id: user['id'] }, 'Login successful');
    res.json({
      data: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: user['id'],
          email: user['email'],
          first_name: user['first_name'],
          last_name: user['last_name'],
          role: user['role'],
          company_id: user['company_id'],
        },
      },
    });
  })
);

// POST /api/auth/refresh
// Rate limited per IP: each call is a database read and up to two writes, and
// nothing else on this route needs a credential to reach the database. Looser
// than login (see refreshRateLimit) because the SPA refreshes on every load.
authRouter.post(
  '/refresh',
  refreshRateLimit,
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.['refresh_token'] as string | undefined;
    if (!raw) {
      res.status(401).json({ error: 'unauthorized', message: 'No refresh token' });
      return;
    }

    const hash = createHash('sha256').update(raw).digest('hex');
    // Cross-tenant lookup via SECURITY DEFINER (no tenant context on refresh).
    const tokenRes = await readPool.query(`SELECT * FROM auth_find_refresh_token($1)`, [hash]);
    const token = tokenRes.rows[0] as Record<string, unknown> | undefined;

    if (
      !token ||
      token['is_revoked'] ||
      token['replaced_by'] ||
      new Date(String(token['absolute_expiry'])) < new Date()
    ) {
      // Token reuse detected — revoke entire family (refresh token rotation)
      if (token?.['family_id']) {
        await withTransaction(String(token['company_id']), async (client) => {
          await client.query(
            `UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1`,
            [token['family_id']]
          );
        });
      }
      res.clearCookie('refresh_token', { path: '/api/auth' });
      res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired session' });
      return;
    }

    const newAccess = signAccessToken({
      userId: String(token['user_id']),
      companyId: String(token['company_id']),
      role: token['role'] as never,
    });

    const newRaw = randomUUID() + randomUUID();
    const newHash = createHash('sha256').update(newRaw).digest('hex');
    await withTransaction(String(token['company_id']), async (client) => {
      const newTok = await client.query<{ id: string }>(
        `INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, absolute_expiry)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [token['company_id'], token['user_id'], newHash, token['family_id'], token['absolute_expiry']]
      );
      await client.query(`UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2`, [
        newTok.rows[0]!.id,
        token['id'],
      ]);
    });

    res.cookie('refresh_token', newRaw, COOKIE_OPTS);
    res.json({ data: { access_token: newAccess, token_type: 'Bearer', expires_in: 900 } });
  })
);

// POST /api/auth/logout
authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.['refresh_token'] as string | undefined;
    if (raw) {
      const hash = createHash('sha256').update(raw).digest('hex');
      await withTransaction(req.auth.companyId, async (client) => {
        await client.query(`UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1`, [hash]);
      });
    }
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.json({ data: { message: 'Logged out' } });
  })
);

// POST /api/auth/register
authRouter.post(
  '/register',
  authRateLimit,
  validate(
    z.object({
      company_name: z.string().min(2).max(100),
      email: z.string().email().max(254),
      password: z.string().min(10).max(128),
      first_name: z.string().min(1).max(50),
      last_name: z.string().min(1).max(50),
    })
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      company_name: string;
      email: string;
      password: string;
      first_name: string;
      last_name: string;
    };

    const hash = await argon2.hash(body.password, ARGON2_OPTS);
    const slug =
      body.company_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 50) +
      '-' +
      Date.now().toString(36);

    // Bootstrap a new tenant via SECURITY DEFINER (no tenant context exists yet).
    // A duplicate email raises 23505, which we map to 409.
    let cid: string;
    let uid: string;
    try {
      const r = await writePool.query<{ company_id: string; user_id: string }>(
        `SELECT company_id, user_id FROM auth_register($1, $2, $3, $4, $5, $6)`,
        [body.company_name, slug, body.email, hash, body.first_name, body.last_name]
      );
      cid = String(r.rows[0]!.company_id);
      uid = String(r.rows[0]!.user_id);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'conflict', message: 'Email already registered' });
        return;
      }
      throw err;
    }

    const token = await issueSession(res, { id: uid, company_id: cid, role: 'owner' });
    res.status(201).json({
      data: {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: uid,
          email: body.email,
          first_name: body.first_name,
          last_name: body.last_name,
          role: 'owner',
          company_id: cid,
        },
      },
    });
  })
);

// GET /api/auth/me
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const db = createRlsClient(readPool, req.auth.companyId);
    const r = await db.query(
      `SELECT id, email, first_name, last_name, role, avatar_url, phone,
              job_title, is_active, company_id, last_login_at
       FROM users WHERE id = $1`,
      [req.auth.userId]
    );
    if (!r.rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.json({ data: r.rows[0] });
  })
);
