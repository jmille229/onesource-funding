import path from 'path';
import type { Response } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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
