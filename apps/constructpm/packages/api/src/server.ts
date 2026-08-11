import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './lib/env.js';
import { connectRedis } from './lib/redis.js';
import { writePool } from './lib/db.js';
import {
  correlationId,
  httpLogger,
  securityHeaders,
  errorHandler,
  notFound,
  authenticate,
  tenantRateLimit,
  requestDeadline,
} from './middleware/index.js';

import { authRouter }          from './modules/auth/auth.router.js';
import { jobsRouter }          from './modules/jobs/jobs.router.js';
import { tasksRouter }         from './modules/tasks/tasks.router.js';
import { budgetRouter }        from './modules/budget/budget.router.js';
import { contactsRouter }      from './modules/contacts/contacts.router.js';
import { changeOrdersRouter }  from './modules/change-orders/change-orders.router.js';
import { purchaseOrdersRouter } from './modules/purchase-orders/purchase-orders.router.js';
import { vendorBillsRouter }   from './modules/vendor-bills/vendor-bills.router.js';
import { subcontractsRouter }  from './modules/subcontracts/subcontracts.router.js';
import { invoicesRouter }      from './modules/invoices/invoices.router.js';
import { dailyLogsRouter }     from './modules/daily-logs/daily-logs.router.js';
import { timeTrackingRouter }  from './modules/time-tracking/time-tracking.router.js';
import { filesRouter }         from './modules/files/files.router.js';
import { reportsRouter }       from './modules/reports/reports.router.js';
import { settingsRouter }      from './modules/settings/settings.router.js';
import { factoringRouter }     from './modules/factoring/factoring.router.js';
import { adminRouter }         from './modules/admin/admin.router.js';
import { adminEnabled }        from './lib/admin-db.js';

const app = express();

// Trust the first proxy hop (required for correct IP behind load balancers / Cloudflare)
app.set('trust proxy', 1);

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'blob:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  crossOriginEmbedderPolicy: false, // Allow file downloads
}));

app.use(cors({
  origin: env.APP_URL,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '2mb' }));     // Reduced from 10mb — files go through /api/files/upload
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());
app.use(correlationId);
app.use(httpLogger);
app.use(securityHeaders);
app.use(requestDeadline(30_000));  // 30s global request timeout

// ─── Health endpoints (no auth) ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'constructpm-api', ts: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await writePool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
});

// ─── Public routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ─── Operator console ─────────────────────────────────────────────────────────
// Mounted before the tenant guard: operator tokens carry a different audience
// and must not be run through tenant authentication. Only mounted when an
// admin database connection is configured, so a deployment that doesn't
// operate factoring exposes no cross-tenant surface at all.
if (adminEnabled) {
  app.use('/api/admin', adminRouter);
} else {
  app.use('/api/admin', (_req, res) => {
    res.status(503).json({ error: 'not_configured', message: 'Factoring console is not enabled' });
  });
}

// ─── Protected routes (JWT required for all /api/* beyond auth) ───────────────
// NOTE: tenantRateLimit is applied globally here — this covers /api/files/* as well.
// File-specific rate limiting is handled by the concurrency gate inside files.router.ts
// (MAX_CONCURRENT_UPLOADS) which caps parallel in-flight uploads per API instance.
app.use('/api', authenticate, tenantRateLimit);
app.use('/api/jobs',            jobsRouter);
app.use('/api/tasks',           tasksRouter);
app.use('/api/budget',          budgetRouter);
app.use('/api/contacts',        contactsRouter);
app.use('/api/change-orders',   changeOrdersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/vendor-bills',    vendorBillsRouter);
app.use('/api/subcontracts',    subcontractsRouter);
app.use('/api/invoices',        invoicesRouter);
app.use('/api/daily-logs',      dailyLogsRouter);
app.use('/api/time',            timeTrackingRouter);
app.use('/api/files',           filesRouter);
app.use('/api/reports',         reportsRouter);
app.use('/api/settings',        settingsRouter);
app.use('/api/factoring',       factoringRouter);

app.use(notFound);
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  await connectRedis();

  const server = app.listen(env.PORT, () => {
    console.log(`\n🏗️  ConstructPM API  →  http://localhost:${env.PORT}`);
    console.log(`   DB  →  ${env.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
    console.log(`   ENV →  ${env.NODE_ENV}\n`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    server.close(async () => {
      await writePool.end();
      console.log('✓ Server closed');
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => { console.error('Forced exit after timeout'); process.exit(1); }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Catch unhandled rejections — log and exit so the process manager restarts
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
export { app };
