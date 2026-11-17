/**
 * Two-step sign-in: time-based one-time codes (RFC 6238 — what Google
 * Authenticator, 1Password, Authy and Microsoft Authenticator all speak),
 * plus one-time recovery codes for a lost phone.
 *
 * No dependency: TOTP is an HMAC over a counter, and the whole algorithm is a
 * dozen lines. The RFC's own test vectors pin it (mfa.test.ts).
 *
 * Secrets are encrypted before they're stored (lib/secrets.ts); recovery codes
 * are stored only as hashes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new shared secret: 160 random bits, base32 (what authenticator apps expect). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one 30-second step. `digits` is only for the RFC's 8-digit vectors. */
export function totpAt(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_PERIOD);

/**
 * Checks a code against the current step and one either side (a phone clock
 * a little off). Returns the matching step — the caller records it so the same
 * code can't be used twice — or null.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** What the QR code encodes. */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`;
}

// ─── Recovery codes ───────────────────────────────────────────────────────────
// Ten codes like "k7m2-9qhx-c4tw": unambiguous letters and digits only, 60 bits
// each. Shown once; stored as SHA-256 of the normalised form.
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => RC_ALPHABET[b % RC_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export const normalizeRecoveryCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecoveryCode = (c: string) => createHash('sha256').update(normalizeRecoveryCode(c)).digest('hex');
/** A recovery code looks like 12 letters/digits; a TOTP code is 6 digits. */
export const looksLikeRecoveryCode = (c: string) => normalizeRecoveryCode(c).length === 12;
