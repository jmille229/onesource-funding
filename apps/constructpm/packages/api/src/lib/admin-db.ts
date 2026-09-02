import pg from 'pg';
import { env } from './env.js';
import { QUERY_BOUNDS } from './db.js';

/**
 * Connection pool for the factoring operator role.
 *
 * Separate from the tenant pools on purpose. `constructpm_factoring_admin` holds
 * cross-tenant grants on the factoring tables and nothing else — it is not
 * BYPASSRLS, and has no grant on jobs, budgets, tasks, daily logs, files or
 * subcontracts. Keeping it in its own pool means tenant request handling can
 * never accidentally acquire a connection that reaches across companies.
 *
 * When ADMIN_DATABASE_URL is unset the pool is null and the admin routes are not
 * mounted, so a deployment that doesn't operate factoring holds no cross-tenant
 * credential at all.
 */
export const adminPool: pg.Pool | null = env.ADMIN_DATABASE_URL
  ? new pg.Pool({
      connectionString: env.ADMIN_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...QUERY_BOUNDS,
      ssl: env.DATABASE_SSL
        ? (env.DATABASE_SSL_CA
            ? { rejectUnauthorized: true, ca: env.DATABASE_SSL_CA }
            : { rejectUnauthorized: true })
        : false,
    })
  : null;

adminPool?.on('error', (err) => console.error('[admin-db] Pool error:', err.message));

export const adminEnabled = Boolean(adminPool);

/** Runs `fn` in a transaction on the operator pool. */
export async function withAdminTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!adminPool) throw new Error('admin database is not configured');
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records an operator action. Called inside the same transaction as the change
 * itself, so an audit row cannot go missing when a write succeeds — the entry
 * and the effect commit or roll back together.
 */
export async function audit(
  client: pg.PoolClient,
  entry: {
    platformUserId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    companyId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO factoring_audit_log
       (platform_user_id, action, entity_type, entity_id, company_id, before, after, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.platformUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.companyId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ip ?? null,
    ]
  );
}
