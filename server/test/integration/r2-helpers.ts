/** Reads the R2 emulator of the worktree stack for the catalog tests: a listing under a prefix, an object body, a cleanup. */
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { createS3Client } from '../../src/adapters/s3';

export interface R2Env {
  client: S3Client;
  bucket: string;
  prefix: string;
}

/** The emulator client of this worktree, from the environment of the run (the same variables the server reads). */
export function r2Env(vars: Record<string, string | undefined> = process.env): R2Env {
  const endpoint = vars.T2F_R2_ENDPOINT;
  const bucket = vars.T2F_R2_BUCKET;
  const accessKeyId = vars.T2F_R2_ACCESS_KEY_ID;
  const secretAccessKey = vars.T2F_R2_SECRET_ACCESS_KEY;
  const prefix = vars.T2F_R2_PREFIX;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !prefix) throw new Error('r2: environment is not configured');
  return { client: createS3Client({ endpoint, accessKeyId, secretAccessKey }), bucket, prefix };
}

/** Every key under `prefix`, sorted. */
export async function listKeys(env: R2Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await env.client.send(new ListObjectsV2Command({ Bucket: env.bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys.sort();
}

export async function readObject(env: R2Env, key: string): Promise<string> {
  const res = await env.client.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
  return (await res.Body?.transformToString()) ?? '';
}

export async function deleteUnder(env: R2Env, prefix: string): Promise<void> {
  const keys = await listKeys(env, prefix);
  if (keys.length === 0) return;
  await env.client.send(new DeleteObjectsCommand({ Bucket: env.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
}
