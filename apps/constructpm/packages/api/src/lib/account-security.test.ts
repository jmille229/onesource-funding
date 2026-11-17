/**
 * V020: password reset, email verification and two-step sign-in, at the
 * database. The end-to-end flows run against the API; these pin the rules
 * the functions enforce, whoever calls them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createHash } from 'crypto';

const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const enabled = Boolean(APP_URL && OWNER_URL);

const CO = 'f2000000-0000-0000-0000-000000000001';
const USER = 'e2000000-0000-0000-0000-000000000001';
const EMAIL = 'sec@v020.test';
const h = (t: string) => createHash('sha256').update(t).digest('hex');

let owner: pg.Pool;
let app: pg.Pool;

describe.runIf(enabled)('account security (V020)', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    await owner.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'V020 Co', 'v020-co') ON CONFLICT (id) DO NOTHING`, [CO]);
    await owner.query(`INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
                       VALUES ($1, $2, $3, '$argon2id$old', 'Val', 'Twenty', 'owner') ON CONFLICT (id) DO NOTHING`, [USER, CO, EMAIL]);
    await owner.query(`UPDATE users SET email_verified_at = NULL WHERE id = $1`, [USER]);
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM companies WHERE id = $1`, [CO]).catch(() => {});
    await owner?.end().catch(() => {});
    await app?.end().catch(() => {});
  });

  it('a reset request names the account only if it exists, and not twice a minute', async () => {
    expect((await app.query(`SELECT * FROM auth_request_password_reset('nobody@v020.test', $1)`, [h('a')])).rows).toEqual([]);
    expect((await app.query(`SELECT * FROM auth_request_password_reset($1, $2)`, [EMAIL.toUpperCase(), h('reset-1')])).rows)
      .toEqual([{ email: EMAIL, first_name: 'Val' }]);
    expect((await app.query(`SELECT * FROM auth_request_password_reset($1, $2)`, [EMAIL, h('reset-2')])).rows).toEqual([]);
  });

  it('a reset link sets the password once, ends sessions, and proves the inbox', async () => {
    await owner.query(`INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, absolute_expiry)
                       VALUES ($1, $2, 'rt-v020', gen_random_uuid(), NOW() + interval '1 day')`, [CO, USER]);
    const r = await app.query(`SELECT id FROM auth_accept_invite($1, '$argon2id$new')`, [h('reset-1')]);
    expect(r.rows).toEqual([{ id: USER }]);
    const u = await owner.query(`SELECT password_hash, email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1`, [USER]);
    expect(u.rows[0]).toEqual({ password_hash: '$argon2id$new', verified: true });
    const live = await owner.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND NOT is_revoked`, [USER]);
    expect(live.rows[0].n).toBe(0);
    expect((await app.query(`SELECT id FROM auth_accept_invite($1, '$argon2id$again')`, [h('reset-1')])).rows).toEqual([]);
  });

  it('an email-verification link can never set a password', async () => {
    await owner.query(`INSERT INTO user_invites (user_id, token_hash, expires_at, purpose)
                       VALUES ($1, $2, NOW() + interval '1 day', 'verify')`, [USER, h('verify-1')]);
    expect((await app.query(`SELECT * FROM auth_invite_info($1)`, [h('verify-1')])).rows).toEqual([]);
    expect((await app.query(`SELECT id FROM auth_accept_invite($1, '$argon2id$hijack')`, [h('verify-1')])).rows).toEqual([]);
    expect((await app.query(`SELECT user_id FROM auth_verify_email($1)`, [h('verify-1')])).rows).toEqual([{ user_id: USER }]);
  });

  it('two-step codes: a time step is accepted once, recovery codes once each', async () => {
    await app.query(`SELECT auth_mfa_begin($1, 'v1:secret')`, [USER]);
    expect((await app.query(`SELECT auth_mfa_enable($1, 100, $2) AS ok`, [USER, [h('rc1'), h('rc2')]])).rows[0].ok).toBe(true);
    expect((await app.query(`SELECT auth_mfa_use_step($1, 100) AS ok`, [USER])).rows[0].ok).toBe(false);
    expect((await app.query(`SELECT auth_mfa_use_step($1, 101) AS ok`, [USER])).rows[0].ok).toBe(true);
    expect((await app.query(`SELECT auth_mfa_use_step($1, 101) AS ok`, [USER])).rows[0].ok).toBe(false);
    expect((await app.query(`SELECT auth_mfa_use_recovery($1, $2) AS ok`, [USER, h('rc1')])).rows[0].ok).toBe(true);
    expect((await app.query(`SELECT auth_mfa_use_recovery($1, $2) AS ok`, [USER, h('rc1')])).rows[0].ok).toBe(false);
    const st = (await app.query(`SELECT mfa_enabled, recovery_left FROM auth_mfa_state($1)`, [USER])).rows[0];
    expect(st).toEqual({ mfa_enabled: true, recovery_left: 1 });
  });

  it('the app role cannot read recovery codes directly', async () => {
    await expect(app.query(`SELECT * FROM user_mfa_recovery_codes`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`SELECT * FROM platform_mfa_recovery_codes`)).rejects.toThrow(/permission denied/);
  });
});
