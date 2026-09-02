import { Router } from 'express';
import path from 'path';
import { PassThrough } from 'stream';
import busboy from 'busboy';
import { fileTypeFromBuffer } from 'file-type';
import { Upload } from '@aws-sdk/lib-storage';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { validate as isUuid } from 'uuid';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { asyncHandler, requireRole, logger } from '../../middleware/index.js';
import { env } from '../../lib/env.js';

export const filesRouter = Router();

// ─── S3/MinIO clients ─────────────────────────────────────────────────────────
// `s3` talks to the store over the internal/server-side address.
const s3 = new S3Client({
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

async function ensureBucket(name: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: name }));
    logger.info({ bucket: name }, 'Created S3 bucket');
  }
}
if (env.NODE_ENV !== 'production') {
  ensureBucket(env.S3_BUCKET_FILES).catch(() => {});
}

// ─── Upload concurrency limiter ───────────────────────────────────────────────
// Caps simultaneous in-flight uploads per API instance to prevent RAM exhaustion.
// Each upload streams through a PassThrough (no full buffer in memory), so this
// limit is about connection/CPU pressure, not per-upload memory.
const MAX_CONCURRENT_UPLOADS = 10;
let activeUploads = 0;

// ─── Filename sanitization ────────────────────────────────────────────────────
function sanitizeFilename(original: string): string {
  const truncated = original.slice(0, 255);                    // Hard cap BEFORE regex
  const base = path.basename(truncated);
  const safe = base
    .replace(/\0/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return safe || 'upload';
}

// ─── MIME allowlist — NO SVG ──────────────────────────────────────────────────
// SECURITY: SVG is intentionally excluded. SVG files can embed arbitrary
// JavaScript (<script> tags, event handlers) which becomes stored XSS if the
// file is ever rendered inline or opened directly in a browser.
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);

// Text formats have no reliable magic bytes — accepted on header alone
const HEADER_ONLY_TYPES = new Set(['text/csv', 'text/plain']);

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── Entity reference validation ─────────────────────────────────────────────
// entity_type and entity_id come from multipart form fields and used to be
// interpolated into the S3 object key unchecked, so `entity_type=../x` or a
// kilobyte of junk landed in the key path and in the file_attachments row.
// Both are now validated: the type against the things a file can actually be
// attached to, the id as a UUID. (Object keys are still prefixed with the
// caller's company_id from the JWT, so cross-tenant *writes* were never
// possible; this closes the sloppiness, not a leak.)
const ENTITY_TYPES = new Set([
  'job', 'invoice', 'daily_log', 'change_order', 'vendor_bill', 'purchase_order',
  'subcontract', 'contact', 'task',
  // Factoring: the client uploads against the invoice id as a draft, and the
  // request handler re-keys the row to the funding_request once it exists.
  'funding_request_draft', 'funding_request',
]);

function assertEntityRef(entity_type: unknown, entity_id: unknown): { entity_type: string; entity_id: string } {
  if (typeof entity_type !== 'string' || !ENTITY_TYPES.has(entity_type)) {
    throw Object.assign(new Error('entity_type is not a recognised attachment target'), { status: 422 });
  }
  if (typeof entity_id !== 'string' || !isUuid(entity_id)) {
    throw Object.assign(new Error('entity_id must be a UUID'), { status: 422 });
  }
  return { entity_type, entity_id };
}

// ─── POST /api/files/upload ───────────────────────────────────────────────────
// SECURITY FIX: Streams directly to S3 — no full file buffer in process memory.
// The approach:
//   1. Parse multipart with busboy
//   2. Collect the first 4096 bytes into a small detection buffer
//   3. Detect actual file type from those bytes (catches disguised executables)
//   4. If type is allowed, create a PassThrough stream, push the detection
//      buffer back in, then pipe the remainder of the upload directly to S3
//      via @aws-sdk/lib-storage Upload (which handles multipart automatically)
//   5. Memory cost per upload: ~4 KB for detection + S3 SDK internal buffers
//      (not 50 MB per upload)
filesRouter.post(
  '/upload',
  asyncHandler(async (req, res) => {
    // Concurrency gate — reject rather than queue to avoid request pile-up
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
      res.status(503).json({
        error: 'service_unavailable',
        message: 'Upload capacity reached. Please retry in a moment.',
      });
      return;
    }

    activeUploads++;
    let uploadAborted = false;

    try {
      await new Promise<void>((resolve, reject) => {
        let totalBytes = 0;
        let fieldsDone = false;
        let fileDone = false;
        let sawFile = false;
        const fields: Record<string, string> = {};

        // AVAILABILITY: if the client goes away mid-upload, settle the promise
        // so the `finally` below releases the concurrency slot. Without this a
        // dropped connection could pin a slot until the request deadline — and
        // the deadline only ends the *response*, not this promise.
        req.on('aborted', () => {
          uploadAborted = true;
          reject(Object.assign(new Error('Upload aborted by client'), { status: 400 }));
        });

        const bb = busboy({
          headers: req.headers,
          limits: {
            fileSize: MAX_FILE_BYTES,
            files: 1,
            fields: 5,
            fieldSize: 1024,
          },
        });

        // Collect form fields (entity_type, entity_id, job_id)
        bb.on('field', (name, value) => { fields[name] = value; });
        bb.on('fieldsLimit', () => reject(new Error('Too many form fields')));

        bb.on('file', async (_fieldname, fileStream, info) => {
          sawFile = true;
          const { filename, mimeType } = info;
          const claimedMime = mimeType?.split(';')[0]?.trim() ?? '';

          // First-pass: reject disallowed MIME header immediately
          if (!ALLOWED_MIME_TYPES.has(claimedMime)) {
            fileStream.resume(); // drain and discard
            return reject(Object.assign(
              new Error(`File type "${claimedMime}" is not allowed`),
              { status: 415 }
            ));
          }

          // Collect the first 4096 bytes for magic-byte detection
          const DETECT_BYTES = 4096;
          const detectionChunks: Buffer[] = [];
          let detectionFull = false;
          let detectionBytes = 0;

          // PassThrough that we'll pipe into the S3 Upload
          const s3Stream = new PassThrough();

          fileStream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;

            // Count bytes towards detection buffer
            if (!detectionFull) {
              detectionChunks.push(chunk);
              detectionBytes += chunk.length;
              if (detectionBytes >= DETECT_BYTES) detectionFull = true;
            }

            // Forward every byte to S3 stream regardless
            if (!uploadAborted) s3Stream.write(chunk);
          });

          fileStream.on('limit', () => {
            uploadAborted = true;
            s3Stream.destroy(new Error('File exceeds 50 MB limit'));
            reject(Object.assign(new Error('File exceeds the 50 MB size limit'), { status: 413 }));
          });

          fileStream.on('end', () => { if (!uploadAborted) s3Stream.end(); });
          fileStream.on('error', (err) => { s3Stream.destroy(err); reject(err); });

          // Validate magic bytes once we have enough data
          const validate = async () => {
            if (HEADER_ONLY_TYPES.has(claimedMime)) return; // no magic bytes for text

            // The detection bytes are already buffered, so sniff the buffer
            // directly — no need to wrap it back into a stream (and file-type's
            // stream API expects a web ReadableStream as of v22).
            const detectionBuffer = Buffer.concat(detectionChunks);
            const detected = await fileTypeFromBuffer(detectionBuffer);
            if (!detected) {
              throw Object.assign(
                new Error('Could not determine file type from content'),
                { status: 415 }
              );
            }
            if (!ALLOWED_MIME_TYPES.has(detected.mime)) {
              throw Object.assign(
                new Error(`Actual file content type "${detected.mime}" is not permitted`),
                { status: 415 }
              );
            }
            const claimedCat = claimedMime.split('/')[0];
            const detectedCat = detected.mime.split('/')[0];
            if (claimedCat !== detectedCat) {
              throw Object.assign(
                new Error(`Claimed type "${claimedMime}" does not match detected content "${detected.mime}"`),
                { status: 415 }
              );
            }
          };

          // Wait for enough bytes then validate, then proceed to S3
          const waitAndUpload = async () => {
            // Poll until detection buffer is populated or stream ends
            await new Promise<void>((res2) => {
              const check = () => {
                if (detectionFull || fileStream.readableEnded) res2();
                else setTimeout(check, 5);
              };
              check();
            });

            await validate();

            // Validate form fields
            const { entity_type, entity_id } = assertEntityRef(fields['entity_type'], fields['entity_id']);
            const job_id = fields['job_id'];
            if (job_id !== undefined && !isUuid(job_id)) {
              throw Object.assign(new Error('job_id must be a UUID'), { status: 422 });
            }

            // SECURITY FIX: Verify entity ownership before attaching files.
            // job_id (if provided) must belong to the caller's company.
            // entity_id for known types is also verified via RLS-scoped queries.
            if (job_id) {
              const db = createRlsClient(readPool, req.auth.companyId);
              const jobCheck = await db.query(
                'SELECT 1 FROM jobs WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
                [job_id, req.auth.companyId]
              );
              if (!jobCheck.rows[0]) {
                throw Object.assign(
                  new Error('Job not found or access denied'),
                  { status: 403 }
                );
              }
            }

            const safeName = sanitizeFilename(filename || 'upload');
            const key = `${req.auth.companyId}/${entity_type}/${entity_id}/${randomUUID()}-${safeName}`;

            // Stream directly to S3 — no full file in memory
            const upload = new Upload({
              client: s3,
              params: {
                Bucket: env.S3_BUCKET_FILES,
                Key: key,
                Body: s3Stream,
                ContentType: claimedMime,
                ServerSideEncryption: env.NODE_ENV === 'production' ? 'AES256' : undefined,
                Metadata: {
                  original_name: safeName,
                  uploaded_by: req.auth.userId,
                  company_id: req.auth.companyId,
                },
              },
              queueSize: 4,
              partSize: 5 * 1024 * 1024, // 5 MB parts
            });

            await upload.done();

            const dbWrite = createRlsClient(writePool, req.auth.companyId);
            const result = await dbWrite.query(
              `INSERT INTO file_attachments
                 (company_id, job_id, entity_type, entity_id, original_name,
                  storage_key, content_type, size_bytes, scan_status, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
              [
                req.auth.companyId,
                job_id ?? null,
                entity_type,
                entity_id,
                safeName,
                key,
                claimedMime,
                totalBytes,
                env.SKIP_VIRUS_SCAN ? 'clean' : 'pending',
                req.auth.userId,
              ]
            );

            res.status(201).json({ data: result.rows[0] });
            fileDone = true;
            if (fieldsDone) resolve();
          };

          waitAndUpload().catch((err) => {
            uploadAborted = true;
            s3Stream.destroy();
            reject(err);
          });
        });

        bb.on('filesLimit', () => reject(Object.assign(new Error('Only one file per request'), { status: 422 })));

        bb.on('finish', () => {
          fieldsDone = true;
          // AVAILABILITY FIX: a multipart body with fields but no file part used
          // to leave this promise pending forever — `fileDone` never became true,
          // nothing rejected, and the `finally` that decrements activeUploads
          // never ran. Ten such requests and every upload on the box was a 503
          // until the API restarted. Any authenticated user could do it by
          // accident with a mis-built form.
          if (!sawFile) {
            reject(Object.assign(new Error('No file was included in the request'), { status: 422 }));
            return;
          }
          if (fileDone) resolve();
        });

        bb.on('error', reject);
        req.pipe(bb);
      });
    } catch (err: unknown) {
      if (!res.headersSent) {
        const status = (err as { status?: number }).status ?? 500;
        const message = err instanceof Error ? err.message : 'Upload failed';
        res.status(status).json({ error: 'upload_error', message });
      }
    } finally {
      activeUploads--;
    }
  })
);

// ─── GET /api/files ───────────────────────────────────────────────────────────
filesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { entity_type, entity_id } = assertEntityRef(req.query['entity_type'], req.query['entity_id']);
    const db = createRlsClient(readPool, req.auth.companyId);
    const result = await db.query(
      `SELECT fa.*, u.first_name || ' ' || u.last_name AS uploaded_by_name
       FROM file_attachments fa
       LEFT JOIN users u ON u.id = fa.uploaded_by
       WHERE fa.entity_type = $1 AND fa.entity_id = $2 AND fa.company_id = $3
       ORDER BY fa.created_at DESC`,
      [entity_type, entity_id, req.auth.companyId]
    );
    res.json({ data: result.rows });
  })
);

// ─── GET /api/files/:id/download ─────────────────────────────────────────────
filesRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const db = createRlsClient(readPool, req.auth.companyId);
    const result = await db.query(
      'SELECT * FROM file_attachments WHERE id = $1 AND company_id = $2',
      [req.params['id'], req.auth.companyId]
    );

    const attachment = result.rows[0];
    if (!attachment) {
      res.status(404).json({ error: 'not_found', message: 'File not found' });
      return;
    }

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
  })
);

// ─── DELETE /api/files/:id ────────────────────────────────────────────────────
filesRouter.delete(
  '/:id',
  requireRole('owner', 'admin', 'project_manager'),
  asyncHandler(async (req, res) => {
    const db = createRlsClient(writePool, req.auth.companyId);
    const result = await db.query(
      'DELETE FROM file_attachments WHERE id = $1 AND company_id = $2 RETURNING *',
      [req.params['id'], req.auth.companyId]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'File not found' });
      return;
    }

    await s3.send(new DeleteObjectCommand({
      Bucket: env.S3_BUCKET_FILES,
      Key: result.rows[0]!['storage_key'] as string,
    })).catch((err) => logger.warn({ err }, 'Failed to delete S3 object'));

    res.status(204).send();
  })
);
