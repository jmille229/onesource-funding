import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { randomUUID, createHash } from 'crypto';
import { writePool, readPool } from '../../lib/db.js';
import { signAccessToken } from '../../lib/jwt.js';
import { asyncHandler, authRateLimit, authenticate, validate, logger } from '../../middleware/index.js';

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

// POST /api/auth/login
authRouter.post(
  '/login',
  authRateLimit,
  validate(z.object({ email: z.string().email(), password: z.string().min(1).max(1024) })),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const userRes = await readPool.query(
      `SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role,
              u.password_hash, u.is_active, u.deleted_at
       FROM users u
       WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true AND u.deleted_at IS NULL
       LIMIT 1`,
      [email]
    );
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

    const accessToken = signAccessToken({
      userId: String(user['id']),
      companyId: String(user['company_id']),
      role: user['role'] as never,
    });

    const rawRefresh = randomUUID() + randomUUID();
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
    const familyId = randomUUID();
    const expiry = new Date(Date.now() + 90 * 86400 * 1000);

    await writePool.query(
      `INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, absolute_expiry)
       VALUES ($1, $2, $3, $4, $5)`,
      [user['company_id'], user['id'], tokenHash, familyId, expiry]
    );
    await writePool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user['id']]);

    logger.info({ user_id: user['id'] }, 'Login successful');
    res.cookie('refresh_token', rawRefresh, COOKIE_OPTS);
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
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.['refresh_token'] as string | undefined;
    if (!raw) {
      res.status(401).json({ error: 'unauthorized', message: 'No refresh token' });
      return;
    }

    const hash = createHash('sha256').update(raw).digest('hex');
    const tokenRes = await writePool.query(
      `SELECT rt.*, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [hash]
    );
    const token = tokenRes.rows[0] as Record<string, unknown> | undefined;

    if (
      !token ||
      token['is_revoked'] ||
      token['replaced_by'] ||
      new Date(String(token['absolute_expiry'])) < new Date()
    ) {
      // Token reuse detected — revoke entire family (refresh token rotation)
      if (token?.['family_id']) {
        await writePool.query(
          `UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1`,
          [token['family_id']]
        );
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
    const newTok = await writePool.query<{ id: string }>(
      `INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, absolute_expiry)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [token['company_id'], token['user_id'], newHash, token['family_id'], token['absolute_expiry']]
    );
    await writePool.query(
      `UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2`,
      [newTok.rows[0]!.id, token['id']]
    );

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
      await writePool.query(
        `UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1`,
        [hash]
      );
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

    const exists = await readPool.query(
      `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)`,
      [body.email]
    );
    if ((exists.rowCount ?? 0) > 0) {
      res.status(409).json({ error: 'conflict', message: 'Email already registered' });
      return;
    }

    const hash = await argon2.hash(body.password, ARGON2_OPTS);
    const slug =
      body.company_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 50) +
      '-' +
      Date.now().toString(36);

    const client = await writePool.connect();
    try {
      await client.query('BEGIN');
      const cRes = await client.query<{ id: string }>(
        `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
        [body.company_name, slug]
      );
      const cid = cRes.rows[0]!.id;
      const uRes = await client.query<{ id: string }>(
        `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, 'owner') RETURNING id`,
        [cid, body.email, hash, body.first_name, body.last_name]
      );
      await client.query('COMMIT');

      const token = signAccessToken({ userId: uRes.rows[0]!.id, companyId: cid, role: 'owner' });
      res.status(201).json({
        data: {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 900,
          user: {
            id: uRes.rows[0]!.id,
            email: body.email,
            first_name: body.first_name,
            last_name: body.last_name,
            role: 'owner',
            company_id: cid,
          },
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// GET /api/auth/me
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const r = await readPool.query(
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
