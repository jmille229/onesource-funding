import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from './env.js';
import type { JwtPayload, UserRole } from '@constructpm/shared';

// SECURITY: Algorithm selection — never downgrades silently.
//
// Rule: if RS256 keys are present, always use RS256 regardless of NODE_ENV.
//       This means a developer who sets JWT_PRIVATE_KEY in their local env gets
//       RS256 locally, which is fine and actually better.
//       HS256 is only used when no RSA keys are configured (local dev without keys).
//
// Risk of the previous pattern (`NODE_ENV === 'production' ? 'RS256' : 'HS256'`):
//   A server accidentally started with NODE_ENV=development would silently
//   downgrade to HS256 even if RS256 keys were present and should be used.
const hasRsaKeys = Boolean(env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY);
const ALGORITHM  = hasRsaKeys ? 'RS256' : 'HS256';
const SIGN_KEY   = hasRsaKeys ? env.JWT_PRIVATE_KEY! : env.JWT_SECRET;
const VERIFY_KEY = hasRsaKeys ? env.JWT_PUBLIC_KEY!  : env.JWT_SECRET;

// In production, RSA keys are required — the superRefine in env.ts enforces this.
// This check is a belt-and-suspenders guard that also catches misconfigured staging envs.
if (env.NODE_ENV === 'production' && !hasRsaKeys) {
  console.error('FATAL: Production requires JWT_PRIVATE_KEY and JWT_PUBLIC_KEY (RS256)');
  process.exit(1);
}

export function signAccessToken(payload: { userId: string; companyId: string; role: UserRole }): string {
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 15 * 60;             // 15-minute access token
  const abs = iat + 90 * 24 * 60 * 60;  // 90-day absolute session ceiling

  return jwt.sign(
    {
      sub: payload.userId,
      cid: payload.companyId,
      role: payload.role,
      jti,
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      exp,
      iat,
      abs,
    } satisfies JwtPayload,
    SIGN_KEY,
    { algorithm: ALGORITHM as jwt.Algorithm }
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, VERIFY_KEY, {
    algorithms: [ALGORITHM as jwt.Algorithm],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as JwtPayload;

  // SECURITY: Enforce absolute session expiry in addition to token expiry
  if (payload.abs && payload.abs < Math.floor(Date.now() / 1000)) {
    throw new Error('Session has expired. Please log in again.');
  }

  return payload;
}
