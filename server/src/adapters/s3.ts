/**
 * S3-compatible object store adapter (AC-72, AC-73), ring 4: Cloudflare R2 in production, the `r2` emulator
 * of the compose stack on a worktree. The keys come from the environment only and never reach a log.
 */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from '../catalog/ports';

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
  };
}
