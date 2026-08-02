import { describe, it, expect } from 'vitest';
import { buildUpdateSet } from './sql.js';

const ALLOWED = ['summary', 'weather', 'delays'] as const;

describe('buildUpdateSet', () => {
  it('builds a parameterized SET clause for allowed columns', () => {
    const { clause, values } = buildUpdateSet({ summary: 'rain', weather: 'wet' }, ALLOWED);
    expect(clause).toBe('summary = $2, weather = $3');
    expect(values).toEqual(['rain', 'wet']);
  });

  it('honours a custom placeholder start index', () => {
    const { clause } = buildUpdateSet({ summary: 'x' }, ALLOWED, 5);
    expect(clause).toBe('summary = $5');
  });

  it('drops keys that are not on the allowlist', () => {
    const { clause, values } = buildUpdateSet({ summary: 'ok', nope: 'x' }, ALLOWED);
    expect(clause).toBe('summary = $2');
    expect(values).toEqual(['ok']);
  });

  it('ignores explicitly-undefined values', () => {
    const { clause } = buildUpdateSet({ summary: undefined, weather: 'dry' }, ALLOWED);
    expect(clause).toBe('weather = $2');
  });

  // REGRESSION: daily-logs PATCH used to interpolate `Object.keys(req.body)`
  // straight into the SET clause with no allowlist. This payload was confirmed
  // to exfiltrate users.password_hash into a readable field.
  it('neutralises the confirmed SQL-injection payload', () => {
    const evil = { 'summary=(SELECT password_hash FROM users LIMIT 1), notes': 'decoy' };
    const { clause, values } = buildUpdateSet(evil, ALLOWED);
    expect(clause).toBe('');
    expect(values).toEqual([]);
  });

  it.each([
    'company_id',                       // cross-tenant reassignment
    'id',                               // primary-key overwrite
    'password_hash',                    // credential write
    'summary, company_id',              // smuggled second column
    "summary='x' --",                   // comment-out injection
  ])('rejects unsafe key %j', (key) => {
    expect(buildUpdateSet({ [key]: 'v' }, ALLOWED).clause).toBe('');
  });

  it('throws if the allowlist itself contains a non-identifier', () => {
    expect(() => buildUpdateSet({ a: 1 }, ['summary; DROP TABLE users'])).toThrow(/unsafe column/);
  });
});
