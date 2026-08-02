import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Local dev convenience only; in containers the environment is injected.
if (process.env['NODE_ENV'] !== 'production') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.join(here, '../../../.env.local') });
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Migrations create roles, SECURITY DEFINER functions and FORCE RLS, so they must
// run as the owner role (superuser / BYPASSRLS / CREATEROLE) — never as the
// RLS-scoped application role.
const connectionString =
  process.env['MIGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://constructpm:constructpm_dev@localhost:5432/constructpm_dev';

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000 });

// Two concurrent deploys must not apply the same migration twice. A session-level
// advisory lock serialises them; the second waits, then finds nothing to do.
const LOCK_KEY = 0x0c04_5150; // arbitrary, stable

async function waitForDatabase(retries = 30, delayMs = 2_000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const c = await pool.connect();
      c.release();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  … waiting for database (${attempt}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function runMigrations(): Promise<void> {
  await waitForDatabase();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version
      )
    );

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;

    for (const file of files) {
      const version = file.replace('.sql', '');
      if (applied.has(version)) continue;

      console.log(`  ▶ applying ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

      // Each migration is atomic: either the whole file lands and is recorded, or
      // nothing is. Without this a half-applied file leaves the schema in a state
      // no later migration can assume anything about.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      count++;
    }

    console.log(count === 0 ? '  ✓ schema up to date' : `  ✓ applied ${count} migration(s)`);

    // Set (or rotate) the application role's password. Idempotent, and running it
    // on every deploy means changing CONSTRUCTPM_APP_PASSWORD in the environment
    // is all it takes to rotate the credential.
    const appPassword = process.env['CONSTRUCTPM_APP_PASSWORD'];
    if (appPassword) {
      const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'constructpm_app'`);
      if (exists.rowCount) {
        // Passwords cannot be bound as parameters in ALTER ROLE, so build the
        // statement server-side with format(%L), which quotes and escapes the
        // literal correctly — never string-concatenate it in JS.
        const stmt = await client.query<{ sql: string }>(
          `SELECT format('ALTER ROLE constructpm_app WITH LOGIN PASSWORD %L', $1::text) AS sql`,
          [appPassword]
        );
        await client.query(stmt.rows[0]!.sql);
        console.log('  ✓ constructpm_app credentials set');
      } else {
        throw new Error('constructpm_app role missing — did V002 run?');
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
    await pool.end();
  }
}

runMigrations()
  .then(() => console.log('\n✅ migrations complete\n'))
  .catch((err) => {
    console.error('\n❌ migration failed:', err.message, '\n');
    process.exit(1);
  });
