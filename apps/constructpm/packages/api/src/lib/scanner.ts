/**
 * Malware scanning for uploaded files, with ClamAV.
 *
 * On when CLAMAV_HOST is set (the `clamav` service in docker-compose.prod.yml).
 * Every stored object is scanned once — straight after upload, in the
 * background — and the verdict cached in file_scans. Every download path goes
 * through deliverAttachment, which makes sure the object has been scanned and
 * refuses to hand out one flagged as infected.
 *
 * If the scanner is unreachable, downloads still work (failing closed would
 * take every document offline); the error is logged and reported so it gets
 * fixed. With CLAMAV_HOST unset nothing is scanned.
 */
import net from 'net';
import { once } from 'events';
import { createHash } from 'crypto';
import type { Readable } from 'stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';
import { writePool } from './db.js';
import { reportError } from './monitoring.js';

export const scanningEnabled = Boolean(env.CLAMAV_HOST);

export interface ScanResult { infected: boolean; signature: string | null }

/** clamd's INSTREAM: length-prefixed chunks, a zero-length terminator, one reply line. */
export function clamdScan(stream: Readable | AsyncIterable<Buffer | Uint8Array>, host: string, port: number,
  timeoutMs = 120_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let reply = '';
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error('clamd timed out')));
    sock.on('data', (d) => { reply += d.toString('utf8'); });
    sock.on('error', (err) => done(() => reject(err)));
    sock.on('close', () => done(() => {
      const r = reply.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(r)) resolve({ infected: false, signature: null });
      else if (/FOUND$/.test(r)) resolve({ infected: true, signature: r.replace(/^[^:]*:\s*/, '').replace(/\s*FOUND$/, '') });
      else reject(new Error(`clamd: ${r || 'no reply'}`));
    }));
    sock.once('connect', () => {
      void (async () => {
        try {
          sock.write('zINSTREAM\0');
          for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
            const buf = Buffer.from(chunk);
            for (let i = 0; i < buf.length; i += 64 * 1024) {
              const part = buf.subarray(i, i + 64 * 1024);
              const len = Buffer.alloc(4);
              len.writeUInt32BE(part.length);
              if (!sock.write(Buffer.concat([len, part]))) await once(sock, 'drain');
            }
          }
          sock.end(Buffer.from([0, 0, 0, 0]));
        } catch (err) {
          sock.destroy(err as Error);
        }
      })();
    });
  });
}

const keyHash = (storageKey: string) => createHash('sha256').update(storageKey).digest('hex');

/**
 * The verdict for a stored object: scanned now if it hasn't been. Returns
 * 'skipped' when scanning is off and 'unavailable' when the scanner can't be
 * reached (the caller lets the download through).
 */
export async function ensureScanned(storageKey: string): Promise<'clean' | 'infected' | 'skipped' | 'unavailable'> {
  if (!scanningEnabled) return 'skipped';
  const h = keyHash(storageKey);
  const cached = await writePool.query<{ status: 'clean' | 'infected' }>(`SELECT status FROM file_scans WHERE key_hash = $1`, [h]);
  if (cached.rows[0]) return cached.rows[0].status;
  try {
    // Imported lazily: storage.ts imports this module.
    const { s3 } = await import('./storage.js');
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET_FILES, Key: storageKey }));
    if (!obj.Body) return 'unavailable';
    const result = await clamdScan(obj.Body as Readable, env.CLAMAV_HOST!, env.CLAMAV_PORT);
    const status = result.infected ? 'infected' : 'clean';
    await writePool.query(
      `INSERT INTO file_scans (key_hash, status, signature) VALUES ($1, $2, $3)
       ON CONFLICT (key_hash) DO UPDATE SET status = EXCLUDED.status, signature = EXCLUDED.signature, scanned_at = NOW()`,
      [h, status, result.signature]);
    if (result.infected) reportError(new Error(`Malware found in an upload: ${result.signature}`), { key_hash: h });
    return status;
  } catch (err) {
    reportError(err, { where: 'malware scan', key_hash: h });
    return 'unavailable';
  }
}

/** Scan right after an upload, without making the uploader wait. */
export function scanInBackground(storageKey: string) {
  if (!scanningEnabled) return;
  void ensureScanned(storageKey).catch(() => {});
}

/** Is the scanner answering? (clamd PING → PONG.) */
export function clamdPing(host = env.CLAMAV_HOST, port = env.CLAMAV_PORT, timeoutMs = 3000): Promise<boolean> {
  if (!host) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let reply = '';
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
    sock.on('connect', () => sock.end('zPING\0'));
    sock.on('data', (d) => { reply += d.toString(); });
    sock.on('close', () => resolve(reply.replace(/\0/g, '').trim() === 'PONG'));
    sock.on('error', () => resolve(false));
  });
}
