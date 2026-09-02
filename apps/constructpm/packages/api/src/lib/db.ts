import pg from 'pg';
import { validate as isUuid } from 'uuid';
import { env } from './env.js';

function buildSslConfig(): pg.ConnectionConfig['ssl'] {
  // DATABASE_SSL is an explicit switch rather than an inference from NODE_ENV.
  //
  // Both production topologies are legitimate and they need opposite settings:
  //   - Managed Postgres over the public internet (RDS/Neon/Supabase) → TLS required.
  //   - Postgres on a private Docker network on the same host → no TLS listener at
  //     all, and forcing it fails the connection outright with "The server does not
  //     support SSL connections".
  // Deriving this from NODE_ENV silently broke the second case, so it is now
  // configured directly. Default: on when a CA is supplied, otherwise off.
  if (!env.DATABASE_SSL) return false;

  // SECURITY: rejectUnauthorized validates the server certificate. DATABASE_SSL_CA
  // supplies the CA for providers not in the system trust store (e.g. AWS RDS).
  return env.DATABASE_SSL_CA
    ? { rejectUnauthorized: true, ca: env.DATABASE_SSL_CA }
    : { rejectUnauthorized: true };
}

/**
 * Server-side query bounds, applied to every connection in every pool.
 *
 * The 30-second request deadline in middleware sends the client a 503 but
 * cannot cancel work already running in Postgres — the connection stays busy
 * until the query finishes on its own. Under load that is how a pool empties
 * out. statement_timeout makes Postgres kill the statement itself, just under
 * the request deadline so the client sees one clean error rather than a
 * timeout followed by a late failure. idle_in_transaction_session_timeout
 * closes a transaction whose client stopped talking mid-way (a crashed
 * handler, a dropped connection), so it cannot hold row locks indefinitely.
 */
export const QUERY_BOUNDS = {
  statement_timeout: 25_000,
  idle_in_transaction_session_timeout: 30_000,
} as const;

function makePool(url: string, max = 20): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: buildSslConfig(),
    ...QUERY_BOUNDS,
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
    async query<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) {
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
