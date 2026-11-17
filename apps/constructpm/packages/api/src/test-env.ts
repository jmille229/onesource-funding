// Unit tests import modules that read src/lib/env.ts, which exits when the
// server's required settings are missing — as they are in CI. Fill those with
// harmless placeholders; anything already set (a developer's .env.local, or a
// real TEST_* database) wins.
process.env['DATABASE_URL'] ??= process.env['TEST_APP_DATABASE_URL'] ?? 'postgresql://unused@127.0.0.1:1/unused';
process.env['JWT_SECRET'] ??= 'test-only-'.padEnd(64, 'x');
process.env['S3_ACCESS_KEY'] ??= 'test';
process.env['S3_SECRET_KEY'] ??= 'test';
