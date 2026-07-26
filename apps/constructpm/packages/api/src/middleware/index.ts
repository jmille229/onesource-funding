import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { verifyAccessToken } from '../lib/jwt.js';
import { redis } from '../lib/redis.js';
import type { AuthContext, UserRole } from '@constructpm/shared';

// ─── Logger ──────────────────────────────────────────────────────────────────
export const logger = pino({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  transport: process.env['NODE_ENV'] !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export const httpLogger = pinoHttp({
  logger,
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  customProps: (req: Request) => ({ correlation_id: req.correlationId }),
  // Never log request bodies (may contain passwords)
  serializers: { req: (req) => ({ method: req.method, url: req.url, id: req.id }) },
});

// ─── Type augmentation ────────────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth: AuthContext;
    }
  }
}

// ─── Correlation ID ──────────────────────────────────────────────────────────
export function correlationId(req: Request, res: Response, next: NextFunction) {
  // Only trust X-Correlation-ID from internal services, not from clients
  req.correlationId = randomUUID();
  res.setHeader('X-Request-ID', req.correlationId);
  next();
}

// ─── Security headers ────────────────────────────────────────────────────────
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // This is a JSON API — responses should never load or embed anything, and must
  // never be framed. (X-XSS-Protection is deprecated and intentionally omitted.)
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// ─── Authentication ──────────────────────────────────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.auth = { userId: payload.sub, companyId: payload.cid, role: payload.role, jti: payload.jti };
    next();
  } catch (err) {
    res.status(401).json({
      error: 'unauthorized',
      message: err instanceof Error ? err.message : 'Invalid token',
    });
  }
}

// ─── Role guard ──────────────────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'forbidden', message: `Requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}

// ─── Rate limiters — Redis-backed in production, memory fallback in dev ───────
function makeRateLimiter(opts: { points: number; duration: number; keyPrefix: string }) {
  if (redis.status === 'ready') {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: opts.keyPrefix,
      points: opts.points,
      duration: opts.duration,
    });
  }
  // Fallback: in-memory (dev only)
  return new RateLimiterMemory({ points: opts.points, duration: opts.duration });
}

// Lazy-initialized so Redis has time to connect
let _tenantLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let _authLimiter:   RateLimiterRedis | RateLimiterMemory | null = null;

function getTenantLimiter() {
  if (!_tenantLimiter) _tenantLimiter = makeRateLimiter({ points: 500, duration: 60, keyPrefix: 'rl:tenant' });
  return _tenantLimiter;
}
function getAuthLimiter() {
  if (!_authLimiter) _authLimiter = makeRateLimiter({ points: 10, duration: 60, keyPrefix: 'rl:auth' });
  return _authLimiter;
}

export function tenantRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.auth?.companyId ?? req.ip ?? 'unknown';
  getTenantLimiter().consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({ error: 'rate_limit_exceeded', message: 'Too many requests. Please slow down.' });
    });
}

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  // Rate limit by IP for login attempts
  const key = `${req.ip ?? 'unknown'}`;
  getAuthLimiter().consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({ error: 'too_many_requests', message: 'Too many login attempts. Try again in 1 minute.' });
    });
}

// ─── Request timeout ─────────────────────────────────────────────────────────
export function requestDeadline(timeoutMs = 30_000) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'timeout', message: 'Request timed out' });
      }
    }, timeoutMs);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

// ─── Zod validation ──────────────────────────────────────────────────────────
export function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        error: 'validation_error',
        message: 'Invalid request body',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ─── Async handler ────────────────────────────────────────────────────────────
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ─── Error handler ────────────────────────────────────────────────────────────
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : 'Internal server error';
  const status = (err as { status?: number }).status ?? 500;

  if (status >= 500) {
    logger.error({ err, path: req.path, correlation_id: req.correlationId }, message);
  }

  res.status(status).json({
    error: status >= 500 ? 'internal_error' : 'request_error',
    // Never leak internal error messages in production
    message: process.env['NODE_ENV'] === 'production' && status >= 500
      ? 'An unexpected error occurred'
      : message,
    request_id: req.correlationId,
  });
}

// ─── 404 handler ─────────────────────────────────────────────────────────────
export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: 'not_found', message: `${req.method} ${req.path} not found` });
}
