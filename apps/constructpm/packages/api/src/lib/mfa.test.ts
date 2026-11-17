import { describe, it, expect } from 'vitest';
import {
  base32Decode, base32Encode, totpAt, verifyTotp, newTotpSecret, otpauthUri,
  newRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, stepAt,
} from './mfa.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA-1, secret "12345678901234567890".
  const secret = Buffer.from('12345678901234567890');
  it('matches the RFC test vectors', () => {
    expect(totpAt(secret, stepAt(59_000), 8)).toBe('94287082');
    expect(totpAt(secret, stepAt(1_111_111_109_000), 8)).toBe('07081804');
    expect(totpAt(secret, stepAt(1_234_567_890_000), 8)).toBe('89005924');
    expect(totpAt(secret, stepAt(20_000_000_000_000), 8)).toBe('65353130');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('12345678901234567890');
    expect(base32Encode(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(buf);
  });

  it('accepts the current code and one step either side, and says which', () => {
    const s = newTotpSecret();
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = (k: number) => totpAt(base32Decode(s), k);
    expect(verifyTotp(s, code(step), now)).toBe(step);
    expect(verifyTotp(s, code(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(s, code(step + 1), now)).toBe(step + 1);
    expect(verifyTotp(s, code(step - 3), now)).toBeNull();
    expect(verifyTotp(s, '12345', now)).toBeNull();
    expect(verifyTotp(s, `${code(step).slice(0, 3)} ${code(step).slice(3)}`, now)).toBe(step);
  });

  it('builds an otpauth URI an authenticator app can read', () => {
    expect(otpauthUri('ABC234', 'pat@example.com', 'One Source'))
      .toBe('otpauth://totp/One%20Source%3Apat%40example.com?secret=ABC234&issuer=One%20Source&algorithm=SHA1&digits=6&period=30');
  });
});

describe('recovery codes', () => {
  it('are ten distinct, readable codes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
  it('hash the same however they are typed', () => {
    expect(hashRecoveryCode('K7M2-9QHX-C4TW')).toBe(hashRecoveryCode(' k7m2 9qhx c4tw '));
    expect(looksLikeRecoveryCode('k7m2-9qhx-c4tw')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
