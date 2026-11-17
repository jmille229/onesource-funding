/**
 * Sending through the Gmail API (lib/gmail.ts) against a stand-in for
 * Google's token and send endpoints, and V022's storage rules at the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import pg from 'pg';
import {
  pkcePair, consentUrl, emailFromIdToken, exchangeCode, sendViaGmail, forgetAccessToken, rawMessage,
  GoogleMailError, GMAIL_SEND_SCOPE,
} from './gmail.js';

const client = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh' };
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; body: string; headers: Record<string, string> };
let calls: Call[];
function stubGoogle(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const c = { url, body: String(init.body), headers: init.headers as Record<string, string> };
    calls.push(c);
    return handler(c);
  }));
}

beforeEach(() => forgetAccessToken());
afterEach(() => vi.unstubAllGlobals());

describe('connecting', () => {
  it('PKCE challenge is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('asks for send-only access, offline, with PKCE', () => {
    const u = new URL(consentUrl({ clientId: client.clientId, redirectUri: 'https://app.x/api/mail/google/callback', state: 'st', challenge: 'ch' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(['openid', 'email', GMAIL_SEND_SCOPE]);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.x/api/mail/google/callback');
  });

  it('reads the mailbox from the ID token', () => {
    expect(emailFromIdToken(idToken({ email: 'Ops@OS-Funding.com', email_verified: true, hd: 'os-funding.com' })))
      .toEqual({ email: 'ops@os-funding.com', verified: true, domain: 'os-funding.com' });
    expect(() => emailFromIdToken(idToken({}))).toThrow(GoogleMailError);
  });

  it('swaps the code for a refresh token', async () => {
    stubGoogle(() => json(200, { refresh_token: 'rt', access_token: 'at', id_token: idToken({ email: 'ops@os-funding.com' }),
                                 scope: `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email` }));
    const got = await exchangeCode(client, { code: 'c', verifier: 'v', redirectUri: 'https://app.x/cb' });
    expect(got).toMatchObject({ refreshToken: 'rt', email: 'ops@os-funding.com' });
    const sent = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(sent)).toMatchObject({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v',
                                                     redirect_uri: 'https://app.x/cb', client_id: client.clientId });
  });

  it('refuses a consent with the send permission unticked', async () => {
    stubGoogle(() => json(200, { refresh_token: 'rt', id_token: idToken({ email: 'a@b.c' }), scope: 'openid email' }));
    await expect(exchangeCode(client, { code: 'c', verifier: 'v', redirectUri: 'r' })).rejects.toThrow(/permission wasn’t ticked/);
  });

  it('explains a wrong client or redirect address', async () => {
    stubGoogle(() => json(401, { error: 'invalid_client' }));
    await expect(exchangeCode(client, { code: 'c', verifier: 'v', redirectUri: 'r' })).rejects.toMatchObject({ kind: 'config' });
    stubGoogle(() => json(400, { error: 'redirect_uri_mismatch' }));
    await expect(exchangeCode(client, { code: 'c', verifier: 'v', redirectUri: 'https://app.x/cb' }))
      .rejects.toThrow(/Add https:\/\/app.x\/cb/);
  });
});

describe('sending', () => {
  const conn = { refreshToken: 'rt', key: 'k1' };
  const mail = { from: 'One Source Funding <noreply@os-funding.com>', to: 'ops@os-funding.com', subject: 'Hello', text: 'Body' };

  it('builds an RFC 5322 message', async () => {
    const raw = Buffer.from(await rawMessage(mail), 'base64url').toString('utf8');
    expect(raw).toMatch(/^From: One Source Funding <noreply@os-funding.com>\r?$/m);
    expect(raw).toMatch(/^To: ops@os-funding.com\r?$/m);
    expect(raw).toMatch(/^Subject: Hello\r?$/m);
    expect(raw).toContain('Body');
  });

  it('gets an access token once, then reuses it', async () => {
    stubGoogle((c) => c.url.includes('oauth2') ? json(200, { access_token: 'at1', expires_in: 3600 }) : json(200, { id: 'm1' }));
    await sendViaGmail(client, conn, mail);
    await sendViaGmail(client, conn, mail);
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ]);
    expect(calls[1]!.headers['Authorization']).toBe('Bearer at1');
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('refresh_token');
    expect(JSON.parse(calls[1]!.body).raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('a new connection gets a new token', async () => {
    stubGoogle((c) => c.url.includes('oauth2') ? json(200, { access_token: 'at', expires_in: 3600 }) : json(200, {}));
    await sendViaGmail(client, conn, mail);
    await sendViaGmail(client, { refreshToken: 'rt2', key: 'k2' }, mail);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('retries once with a fresh token after a 401', async () => {
    let sends = 0;
    stubGoogle((c) => c.url.includes('oauth2') ? json(200, { access_token: `at${calls.length}` })
      : (++sends === 1 ? json(401, { error: { message: 'Invalid Credentials' } }) : json(200, {})));
    await sendViaGmail(client, conn, mail);
    expect(calls.map((c) => c.url.includes('oauth2') ? 'token' : 'send')).toEqual(['token', 'send', 'token', 'send']);
  });

  it('a cancelled permission is "disconnected"', async () => {
    stubGoogle(() => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    await expect(sendViaGmail(client, conn, mail)).rejects.toMatchObject({ kind: 'disconnected' });
  });

  it('the Gmail API switched off in the project is a setup problem', async () => {
    stubGoogle((c) => c.url.includes('oauth2') ? json(200, { access_token: 'at' })
      : json(403, { error: { message: 'Gmail API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }));
    await expect(sendViaGmail(client, conn, mail)).rejects.toMatchObject({ kind: 'config' });
  });

  it('Google being unreachable says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(sendViaGmail(client, conn, mail)).rejects.toMatchObject({ kind: 'unreachable' });
  });
});

// ─── V022 at the database ────────────────────────────────────────────────────
const APP_URL = process.env['TEST_APP_DATABASE_URL'];
const OWNER_URL = process.env['TEST_DATABASE_URL'];
const ADMIN_URL = process.env['TEST_ADMIN_DATABASE_URL'];

describe.runIf(Boolean(APP_URL && OWNER_URL && ADMIN_URL))('the stored connection (V022)', () => {
  let owner: pg.Pool, app: pg.Pool, admin: pg.Pool;
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: OWNER_URL });
    app = new pg.Pool({ connectionString: APP_URL });
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await owner.query('DELETE FROM mail_connections');
  });
  afterAll(async () => {
    await owner.query('DELETE FROM mail_connections');
    await Promise.all([owner.end(), app.end(), admin.end()]);
  });

  it('neither role can read the table itself', async () => {
    await expect(app.query('SELECT * FROM mail_connections')).rejects.toThrow(/permission denied/);
    await expect(admin.query('SELECT * FROM mail_connections')).rejects.toThrow(/permission denied/);
  });

  it('only the operator role connects, sees status or disconnects', async () => {
    await expect(app.query(`SELECT mail_google_save('a@b.c', 'v1:x', 's', NULL)`)).rejects.toThrow(/permission denied/);
    await expect(app.query('SELECT * FROM mail_google_status()')).rejects.toThrow(/permission denied/);
    await expect(app.query('SELECT * FROM mail_google_clear()')).rejects.toThrow(/permission denied/);
    await admin.query(`SELECT mail_google_save('Ops@OS-Funding.com', 'v1:token-1', $1, NULL)`, [GMAIL_SEND_SCOPE]);
    const st = (await admin.query('SELECT * FROM mail_google_status()')).rows[0];
    expect(st).toMatchObject({ email: 'ops@os-funding.com', status: 'ok' });
    expect(Object.keys(st)).not.toContain('refresh_token');
  });

  it('the sender reads the token, and results are recorded against that connection only', async () => {
    const c = (await app.query('SELECT * FROM mail_google_get()')).rows[0];
    expect(c).toMatchObject({ email: 'ops@os-funding.com', refresh_token: 'v1:token-1', status: 'ok' });
    await app.query('SELECT mail_google_result($1, true)', [c.connected_at]);
    expect((await admin.query('SELECT last_sent_at FROM mail_google_status()')).rows[0].last_sent_at).not.toBeNull();

    // Reconnect, then a late failure from the old connection arrives: ignored.
    await admin.query(`SELECT mail_google_save('ops@os-funding.com', 'v1:token-2', 's', NULL)`);
    await app.query(`SELECT mail_google_result($1, false, 'old token', true)`, [c.connected_at]);
    expect((await admin.query('SELECT status, last_error FROM mail_google_status()')).rows[0]).toEqual({ status: 'ok', last_error: null });

    // A failure on the current one marks it broken; a success clears it.
    const now = (await app.query('SELECT connected_at FROM mail_google_get()')).rows[0].connected_at;
    await app.query(`SELECT mail_google_result($1, false, 'Google cancelled the permission', true)`, [now]);
    expect((await admin.query('SELECT status, last_error FROM mail_google_status()')).rows[0])
      .toEqual({ status: 'broken', last_error: 'Google cancelled the permission' });
    await app.query('SELECT mail_google_result($1, true)', [now]);
    expect((await admin.query('SELECT status FROM mail_google_status()')).rows[0].status).toBe('ok');
  });

  it('disconnect hands back the token to revoke, and leaves nothing', async () => {
    expect((await admin.query('SELECT * FROM mail_google_clear()')).rows).toEqual([{ email: 'ops@os-funding.com', refresh_token: 'v1:token-2' }]);
    expect((await app.query('SELECT * FROM mail_google_get()')).rows).toEqual([]);
  });
});
