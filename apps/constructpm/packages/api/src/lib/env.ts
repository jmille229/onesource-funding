import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// SECURITY: Only load .env.local in local development.
// In production, all environment variables are injected by the platform/container
// runtime. Loading a file path here risks accidentally pulling dev secrets if the
// file somehow exists on a production machine.
if (process.env['NODE_ENV'] !== 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.join(__dirname, '../../../../.env.local') });
}

/**
 * Boolean environment variable.
 *
 * NOT z.coerce.boolean() — that is `Boolean(value)`, and every non-empty string
 * is truthy, so the string "false" parses as **true**. Setting DATABASE_SSL=false
 * silently enabled TLS and made every query against a non-TLS Postgres fail with
 * "The server does not support SSL connections".
 *
 * Parses the strings people actually write, and rejects anything ambiguous rather
 * than guessing.
 */
const zBool = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase();
    if (s === '') return undefined;                       // unset → use the default
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return v;                                             // invalid → schema error
  }, z.boolean().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_READER_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),

  // JWT — dev uses symmetric secret (min 64 chars), production uses RSA key pair (RS256)
  // SECURITY: No default value — must be explicitly set in every environment.
  // A missing JWT_SECRET in dev is a loud startup failure, not a silent insecure default.
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  JWT_PRIVATE_KEY: z.string().optional(),  // Required in production (RS256)
  JWT_PUBLIC_KEY: z.string().optional(),   // Required in production (RS256)
  JWT_ISSUER: z.string().default('constructpm-dev'),
  JWT_AUDIENCE: z.string().default('constructpm-app'),

  // S3 / MinIO — no defaults for credentials (must be explicitly set in all envs)
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY is required'),
  S3_BUCKET_FILES: z.string().default('constructpm-files'),
  S3_FORCE_PATH_STYLE: zBool(true),
  // Browser-reachable object-store URL. Set this only when the store is exposed
  // publicly (real S3, or MinIO on its own hostname) — it switches downloads to
  // presigned URLs. Unset means downloads stream through the API, which is what
  // the single-VPS stack does since MinIO there is private to the Docker network.
  S3_PUBLIC_ENDPOINT: z.string().optional(),

  // Email
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: zBool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@constructpm.local'),

  // URLs
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:3001'),

  // Database TLS. Set DATABASE_SSL=true for managed Postgres reached over the
  // public internet; leave false for Postgres on a private Docker network, which
  // has no TLS listener (forcing it there fails the connection outright).
  DATABASE_SSL: zBool(false),
  DATABASE_SSL_CA: z.string().optional(),  // PEM content of the CA cert

  // ─── Factoring operator console ────────────────────────────────────────────
  // Connection for the constructpm_factoring_admin role. When unset, the admin
  // routes are not mounted at all — a deployment that doesn't operate factoring
  // never exposes a cross-tenant surface, and never holds the credential.
  ADMIN_DATABASE_URL: z.string().optional(),
  // Operator tokens carry a different audience from tenant tokens, so a tenant
  // token can never be replayed against an admin route (and vice versa).
  JWT_ADMIN_AUDIENCE: z.string().default('constructpm-admin'),

  // Feature flags
  SKIP_VIRUS_SCAN: zBool(false),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  // In production, RS256 asymmetric keys are required
  if (data.NODE_ENV === 'production') {
    if (!data.JWT_PRIVATE_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JWT_PRIVATE_KEY is required in production (RS256)', path: ['JWT_PRIVATE_KEY'] });
    }
    if (!data.JWT_PUBLIC_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JWT_PUBLIC_KEY is required in production (RS256)', path: ['JWT_PUBLIC_KEY'] });
    }
  }
  // JWT_SECRET has no default — this catches a missing value with a clear message
  // rather than silently using a known insecure string
});

// Docker-secrets convention: a `<VAR>_FILE` env var points to a mounted file whose
// contents become `<VAR>`. This keeps multiline RS256 PEM keys (and any other secret)
// out of the compose/.env files — they live as files on the host and are mounted in.
// Only applied when the plain var isn't already set, so an inline value still wins.
for (const key of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'DATABASE_SSL_CA', 'DATABASE_URL', 'DATABASE_READER_URL'] as const) {
  const filePath = process.env[`${key}_FILE`];
  if (filePath && !process.env[key]) {
    process.env[key] = fs.readFileSync(filePath, 'utf8').trim();
  }
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`   ${field}: ${(errors as string[]).join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
