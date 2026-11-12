import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from './env.js';

/**
 * Field-level encryption for sensitive application numbers (EIN, SSN).
 *
 * AES-256-GCM with a random 12-byte IV per value. Stored as
 * "v1:<iv>:<tag>:<ciphertext>" (base64), so a later key or algorithm can be
 * introduced alongside without guessing what an old value is.
 *
 * The database never sees the plaintext, and the app role cannot read the
 * ciphertext column (V013); only the operator role reads it, to decrypt on an
 * audited reveal.
 */
const key = env.APPLICATION_DATA_KEY ? Buffer.from(env.APPLICATION_DATA_KEY, 'base64') : null;

export const secretsConfigured = Boolean(key && key.length === 32);

function requireKey(): Buffer {
  if (!key || key.length !== 32) {
    throw Object.assign(new Error('Applications are not configured on this server yet'), { status: 503 });
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const k = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const k = requireKey();
  const [version, iv, tag, ct] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

/** "12-3456789" / "123456789" → "123456789", or null if it isn't nine digits. */
export function nineDigits(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

/**
 * Plausibility only — the real check happens in underwriting. Rejects the
 * patterns the SSA never issues (area 000/666/9xx, group 00, serial 0000), and
 * EINs with an unassigned two-digit prefix.
 */
export function validateSecret(kind: 'ein' | 'ssn', digits: string): string | null {
  if (kind === 'ssn') {
    const area = digits.slice(0, 3), group = digits.slice(3, 5), serial = digits.slice(5);
    if (area === '000' || area === '666' || area.startsWith('9') || group === '00' || serial === '0000') {
      return 'That doesn’t look like a valid Social Security number';
    }
    return null;
  }
  const prefix = Number(digits.slice(0, 2));
  const unassigned = [0, 7, 8, 9, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97];
  if (unassigned.includes(prefix)) return 'That doesn’t look like a valid EIN';
  return null;
}

export function formatMasked(kind: 'ein' | 'ssn', last4: string | null): string | null {
  if (!last4) return null;
  return kind === 'ein' ? `••-•••${last4}` : `•••-••-${last4}`;
}
