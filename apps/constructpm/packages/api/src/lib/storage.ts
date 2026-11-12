import path from 'path';
import { PassThrough } from 'stream';
import type { Request, Response } from 'express';
import busboy from 'busboy';
import { fileTypeFromBuffer } from 'file-type';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

// ─── S3/MinIO clients ─────────────────────────────────────────────────────────
// `s3` talks to the store over the internal/server-side address.
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT !== 'https://s3.amazonaws.com' ? env.S3_ENDPOINT : undefined,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// `presignS3` signs URLs that a *browser* will open, so it must sign against the
// externally reachable hostname. Only used when S3_PUBLIC_ENDPOINT is configured;
// otherwise downloads stream through the API (see GET /:id/download).
const presignS3 = env.S3_PUBLIC_ENDPOINT
  ? new S3Client({
      endpoint: env.S3_PUBLIC_ENDPOINT,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    })
  : s3;

// ─── Filename sanitization ────────────────────────────────────────────────────
export function sanitizeFilename(original: string): string {
  const truncated = original.slice(0, 255);                    // Hard cap BEFORE regex
  const base = path.basename(truncated);
  const safe = base
    .replace(/\0/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return safe || 'upload';
}

/**
 * Send a stored attachment to the browser: a short-lived presigned URL when the
 * object store is reachable from outside, otherwise streamed through the API.
 * Used by tenant downloads and by the operator console's document view.
 */
export async function deliverAttachment(
  res: Response,
  attachment: Record<string, unknown>,
): Promise<void> {
  const safeName = sanitizeFilename(String(attachment['original_name']));
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`;

  // Two delivery modes:
  //
  // S3_PUBLIC_ENDPOINT set → hand back a presigned URL so the object store serves
  //   the bytes directly and the API stays out of the data path. The endpoint must
  //   be one the *browser* can resolve; presigning against an internal address
  //   (e.g. http://minio:9000 on a Docker network) produces a URL that resolves
  //   for the API container and for nobody else.
  //
  // Otherwise → stream the object through the API. Slower and it costs API
  // bandwidth, but it works on any topology and keeps the bucket entirely
  // private. This is the default for the single-VPS deployment.
  if (env.S3_PUBLIC_ENDPOINT) {
    const url = await getSignedUrl(
      presignS3,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET_FILES,
        Key: attachment['storage_key'] as string,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: 900 }   // Short-lived — limits exposure of a leaked URL
    );
    res.json({ data: { url, expires_in: 900 } });
    return;
  }

  const object = await s3.send(new GetObjectCommand({
    Bucket: env.S3_BUCKET_FILES,
    Key: attachment['storage_key'] as string,
  }));

  if (!object.Body) {
    res.status(404).json({ error: 'not_found', message: 'File contents missing' });
    return;
  }

  // SECURITY: serve the MIME type we recorded at upload (magic-byte verified),
  // never a client-supplied one, and force download rather than inline render.
  // The column is content_type; this read `mime_type`, which does not exist,
  // so every download went out as application/octet-stream regardless.
  res.setHeader('Content-Type', String(attachment['content_type'] ?? 'application/octet-stream'));
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (object.ContentLength) res.setHeader('Content-Length', String(object.ContentLength));

  const body = object.Body as NodeJS.ReadableStream;
  body.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
  body.pipe(res);
}

// ─── Streaming single-file upload (shared) ───────────────────────────────────
// The same approach as POST /api/files/upload (see files.router.ts): busboy,
// the first 4 KB sniffed for the real file type, then streamed to S3 without
// buffering the whole file. Used by the public funding application and the
// operator's blank-form uploads, which need a stricter type list and their own
// storage keys.

export interface UploadOptions {
  /** MIME types accepted, checked against both the declared and the detected type. */
  allowedMime: ReadonlySet<string>;
  maxBytes: number;
  /**
   * Called once the content has been checked, with the form fields sent before
   * the file, to choose the object key. Throw (with a status) to reject.
   */
  keyFor: (fields: Record<string, string>, safeName: string) => Promise<string> | string;
}

export interface StoredUpload {
  key: string;
  safeName: string;
  contentType: string;
  size: number;
  fields: Record<string, string>;
}

const MAX_CONCURRENT = 10;
let inFlight = 0;

export async function receiveFileUpload(req: Request, opts: UploadOptions): Promise<StoredUpload> {
  if (inFlight >= MAX_CONCURRENT) {
    throw Object.assign(new Error('Upload capacity reached. Please retry in a moment.'), { status: 503 });
  }
  inFlight++;
  try {
    return await new Promise<StoredUpload>((resolve, reject) => {
      let aborted = false;
      let sawFile = false;
      let result: StoredUpload | null = null;
      let finished = false;
      const fields: Record<string, string> = {};
      const done = () => { if (result && finished) resolve(result); };

      req.on('aborted', () => {
        aborted = true;
        reject(Object.assign(new Error('Upload aborted by client'), { status: 400 }));
      });

      const bb = busboy({
        headers: req.headers,
        limits: { fileSize: opts.maxBytes, files: 1, fields: 6, fieldSize: 1024 },
      });
      bb.on('field', (name, value) => { fields[name] = value; });
      bb.on('fieldsLimit', () => reject(Object.assign(new Error('Too many form fields'), { status: 422 })));
      bb.on('filesLimit', () => reject(Object.assign(new Error('Only one file per request'), { status: 422 })));

      bb.on('file', (_name, fileStream, info) => {
        sawFile = true;
        const claimed = info.mimeType?.split(';')[0]?.trim() ?? '';
        if (!opts.allowedMime.has(claimed)) {
          fileStream.resume();
          reject(Object.assign(new Error('That file type isn’t accepted. Upload a PDF or a photo (JPG, PNG).'), { status: 415 }));
          return;
        }
        const head: Buffer[] = [];
        let headBytes = 0;
        let size = 0;
        const out = new PassThrough();

        fileStream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (headBytes < 4096) { head.push(chunk); headBytes += chunk.length; }
          if (!aborted) out.write(chunk);
        });
        fileStream.on('limit', () => {
          aborted = true;
          out.destroy(new Error('too large'));
          reject(Object.assign(
            new Error(`That file is larger than ${Math.round(opts.maxBytes / 1048576)} MB`), { status: 413 }));
        });
        fileStream.on('end', () => { if (!aborted) out.end(); });
        fileStream.on('error', (err) => { out.destroy(err); reject(err); });

        (async () => {
          await new Promise<void>((r) => {
            const check = () => (headBytes >= 4096 || fileStream.readableEnded ? r() : setTimeout(check, 5));
            check();
          });
          const detected = await fileTypeFromBuffer(Buffer.concat(head));
          if (!detected || !opts.allowedMime.has(detected.mime)
              || detected.mime.split('/')[0] !== claimed.split('/')[0]) {
            throw Object.assign(
              new Error('The file’s contents don’t match an accepted type. Upload a PDF or a photo (JPG, PNG).'),
              { status: 415 });
          }
          const safeName = sanitizeFilename(info.filename || 'upload');
          const key = await opts.keyFor(fields, safeName);
          await new Upload({
            client: s3,
            params: {
              Bucket: env.S3_BUCKET_FILES, Key: key, Body: out, ContentType: detected.mime,
              ServerSideEncryption: env.NODE_ENV === 'production' ? 'AES256' : undefined,
            },
            queueSize: 4,
            partSize: 5 * 1024 * 1024,
          }).done();
          result = { key, safeName, contentType: detected.mime, size, fields: { ...fields } };
          done();
        })().catch((err) => { aborted = true; out.destroy(); reject(err); });
      });

      bb.on('finish', () => {
        if (!sawFile) {
          reject(Object.assign(new Error('No file was included'), { status: 422 }));
          return;
        }
        finished = true;
        done();
      });
      bb.on('error', reject);
      req.pipe(bb);
    });
  } finally {
    inFlight--;
  }
}

/** Remove a stored object; best-effort (used to clean up after a failed save). */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET_FILES, Key: key })).catch(() => {});
}
