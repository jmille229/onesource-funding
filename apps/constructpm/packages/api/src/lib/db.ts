import pg from 'pg';
import { validate as isUuid } from 'uuid';
import { env } from './env.js';

function buildSslConfig(): pg.ConnectionConfig['ssl'] {
  if (env.NODE_ENV !== 'production') return false;
  // SECURITY: rejectUnauthorized: true validates the server certificate.
  // DATABASE_SSL_CA provides the CA cert for managed providers (RDS, Supabase, Neon).
  // Without the CA, Node falls back to the system trust store — acceptable for
  // providers whose cert chains are already in the Mozilla bundle (e.g. Neon, Railway),
  // but explicit CA is required for AWS RDS and similar.
  return env.DATABASE_SSL_CA
    ? { rejectUnauthorized: true, ca: env.DATABASE_SSL_CA }
    : { rejectUnauthorized: true };
}

function makePool(url: string, max = 20): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: buildSslConfig(),
  });
  pool.on('error', (err) => console.error('[db] Pool error:', err.message));
  return pool;
}

export const writePool = makePool(env.DATABASE_URL, 20);
export const readPool  = makePool(env.DATABASE_READER_URL ?? env.DATABASE_URL, 30);

function assertValidCompanyId(companyId: string): void {
  if (!isUuid(companyId)) {
    throw new Error(`Invalid companyId: not a valid UUID`);
  }
}

/**
 * RLS-enforced single-query client.
 *
 * set_config(..., is_local => true) only lasts for the current transaction, so
 * the tenant setting and the query MUST run in the same transaction. Running
 * them as separate autocommit statements (the previous behaviour) discarded the
 * setting before the query ran, so RLS saw a NULL tenant and returned zero rows.
 * Wrap both in an explicit transaction. Parameterized set_config — never string
 * interpolation.
 */
export function createRlsClient(pool: pg.Pool, companyId: string) {
  assertValidCompanyId(companyId);
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', ['app.company_id', companyId]);
        const result = await client.query<T>(sql, params);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Full transaction with RLS — parameterized, UUID-validated */
export async function withTransaction<T>(
  companyId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  assertValidCompanyId(companyId);
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.company_id', companyId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
