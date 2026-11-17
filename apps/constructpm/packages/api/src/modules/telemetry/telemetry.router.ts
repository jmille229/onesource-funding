import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, logger, validate, clientErrorRateLimit } from '../../middleware/index.js';
import { reportMessage } from '../../lib/monitoring.js';

/**
 * POST /api/telemetry/client-error — the browser app reports its own crashes
 * here, so they reach error tracking without a third-party script on the page
 * (the CSP allows only this origin). No login needed: errors on the sign-in
 * pages matter too. Bounded and rate limited per IP; query strings and
 * fragments are stripped from URLs, since links carry tokens.
 */
export const telemetryRouter = Router();

const body = z.object({
  message: z.string().max(1000),
  stack: z.string().max(8000).optional().nullable(),
  component_stack: z.string().max(4000).optional().nullable(),
  url: z.string().max(1000).optional().nullable(),
  release: z.string().max(100).optional().nullable(),
});

const pathOnly = (u: string | null | undefined) => {
  if (!u) return null;
  try { return new URL(u).pathname; } catch { return u.split(/[?#]/)[0] ?? null; }
};

telemetryRouter.post('/client-error', clientErrorRateLimit, validate(body), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof body>;
  const page = pathOnly(b.url);
  logger.warn({ page, message: b.message }, 'browser error');
  reportMessage(`Browser: ${b.message}`, { page, stack: b.stack, component_stack: b.component_stack, release: b.release },
    { source: 'browser' });
  res.status(204).end();
}));
