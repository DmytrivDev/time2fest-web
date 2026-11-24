/**
 * S3-compatible object store adapter (AC-72, AC-73), ring 4: Cloudflare R2 in production, the `r2` emulator
 * of the compose stack on a worktree. The keys come from the environment only and never reach a log.
 *
 * SPEC-13b AC-50 (additive; `put` / `delete` unchanged): `get` (stream, absent → null), `head`, `list(prefix)`
 * over every `ListObjectsV2` page, and `putMultipart` — buffers up to `partBytes`; a body that ends within
 * that is one `PutObject`, a longer one is `CreateMultipartUpload` + one `UploadPart` per exactly `partBytes`
 * (R2 wants equal parts except the last) + `CompleteMultipartUpload`; any failure → `AbortMultipartUpload`
 * (best effort) and the original error is rethrown. At most one part is held in memory.
 */
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { ObjectListing, ObjectStore } from '../catalog/ports';

/** Default part size of `putMultipart` (AC-43: multipart above 16 MB). */
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024;

/** 404 of the SDK: `NoSuchKey` (GET), `NotFound` (HEAD) or the bare status. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The emulator is reached by path (`http://127.0.0.1:9090/<bucket>`), a real endpoint by virtual host. */
function isLoopback(endpoint: string): boolean {
  const host = new URL(endpoint).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function createS3Client(config: Omit<S3Config, 'bucket'>): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: 'auto',
    forcePathStyle: isLoopback(config.endpoint),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function createS3ObjectStore(config: S3Config, client: S3Client = createS3Client(config)): ObjectStore {
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return (out.Body as Readable | undefined) ?? null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return { size: Number(out.ContentLength ?? 0), etag: String(out.ETag ?? '') };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async list(prefix) {
      const found: ObjectListing[] = [];
      let token: string | undefined;
      do {
        const out = await client.send(
          new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }),
        );
        for (const o of out.Contents ?? []) {
          if (!o.Key) continue;
          found.push({ key: o.Key, size: Number(o.Size ?? 0), lastModified: o.LastModified ? o.LastModified.getTime() : 0 });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return found;
    },
    putMultipart(key, body, contentType, partBytes = MULTIPART_PART_BYTES) {
      return putMultipart(client, config.bucket, key, body, contentType, partBytes);
    },
  };
}

async function putMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  body: Readable,
  contentType: string,
  partBytes: number,
): Promise<{ size: number }> {
  if (!Number.isInteger(partBytes) || partBytes <= 0) throw new Error('putMultipart: partBytes must be a positive integer');
  let chunks: Buffer[] = [];
  let buffered = 0;
  let size = 0;
  let uploadId: string | undefined;
  const parts: { ETag: string; PartNumber: number }[] = [];

  const take = (n: number): Buffer => {
    const all = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, buffered);
    chunks = n < all.length ? [all.subarray(n)] : [];
    buffered = all.length - n;
    return all.subarray(0, n);
  };
  const uploadPart = async (data: Buffer): Promise<void> => {
    const PartNumber = parts.length + 1;
    const out = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber, Body: data }));
    parts.push({ ETag: String(out.ETag ?? ''), PartNumber });
  };

  try {
    for await (const piece of body as AsyncIterable<Buffer | string>) {
      const buf = typeof piece === 'string' ? Buffer.from(piece) : piece;
      if (buf.length === 0) continue;
      chunks.push(buf);
      buffered += buf.length;
      size += buf.length;
      // Cut only while strictly more than one part is held: the remainder is never empty, so the last
      // part is never a zero-length one, and a body of exactly `partBytes` stays a single PutObject.
      while (buffered > partBytes) {
        if (uploadId === undefined) {
          const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
          if (!created.UploadId) throw new Error('putMultipart: no upload id');
          uploadId = created.UploadId;
        }
        await uploadPart(take(partBytes));
      }
    }
    if (uploadId === undefined) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: take(buffered), ContentType: contentType }));
      return { size };
    }
    await uploadPart(take(buffered));
    await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    return { size };
  } catch (err) {
    if (uploadId !== undefined) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
    }
    if (!body.destroyed) body.destroy();
    throw err;
  }
}
