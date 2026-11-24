/**
 * Адаптер S3 (SPEC-13b AC-50, AC-43, W23) на підставному `S3Client.send`: метод → команда, 404 → null,
 * список усіх сторінок, multipart рівними частинами з перериванням при помилці; `put` і `delete` — як були.
 */
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createS3ObjectStore, MULTIPART_PART_BYTES } from '../../src/adapters/s3';
import type { ObjectStore } from '../../src/catalog/ports';

type Sent = { cmd: string; input: Record<string, unknown> };

function fakeClient(reply: (cmd: string, input: Record<string, unknown>) => unknown) {
  const sent: Sent[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const cmd = command.constructor.name;
      sent.push({ cmd, input: command.input });
      const out = reply(cmd, command.input);
      if (out instanceof Error) throw out;
      return out ?? {};
    },
  } as unknown as S3Client;
  return { client, sent };
}

const CONFIG = { endpoint: 'http://127.0.0.1:9090', bucket: 'b', accessKeyId: 'test-id', secretAccessKey: 'test-secret' }; // check-secrets: allow test fake
const notFound = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
const bodyOf = (sizes: number[]) => Readable.from(sizes.map((n, i) => Buffer.alloc(n, i + 1)));

describe('S3 object store', () => {
  it('keeps the old members: put and delete send the same commands as before', async () => {
    expectTypeOf<ObjectStore['put']>().toEqualTypeOf<(key: string, body: string, contentType: string) => Promise<void>>();
    const { client, sent } = fakeClient(() => ({}));
    const store = createS3ObjectStore(CONFIG, client);
    await store.put('p/catalog/latest.json', '{}', 'application/json');
    await store.delete!('p/catalog/latest.json');
    expect(sent).toEqual([
      { cmd: 'PutObjectCommand', input: { Bucket: 'b', Key: 'p/catalog/latest.json', Body: '{}', ContentType: 'application/json' } },
      { cmd: 'DeleteObjectCommand', input: { Bucket: 'b', Key: 'p/catalog/latest.json' } },
    ]);
  });

  it('get streams the body, head gives size and etag; absent → null; other errors rethrow', async () => {
    const body = Readable.from([Buffer.from('x')]);
    const { client, sent } = fakeClient((cmd, input) => {
      if (input.Key === 'missing') return notFound(cmd === 'GetObjectCommand' ? 'NoSuchKey' : 'NotFound');
      if (input.Key === 'boom') return new Error('boom');
      return cmd === 'GetObjectCommand' ? { Body: body } : { ContentLength: 42, ETag: '"e"' };
    });
    const store = createS3ObjectStore(CONFIG, client);
    expect(await store.get!('k')).toBe(body);
    expect(await store.head!('k')).toEqual({ size: 42, etag: '"e"' });
    expect(await store.get!('missing')).toBeNull();
    expect(await store.head!('missing')).toBeNull();
    await expect(store.get!('boom')).rejects.toThrow('boom');
    await expect(store.head!('boom')).rejects.toThrow('boom');
    expect(sent.map((s) => s.cmd)).toEqual([
      'GetObjectCommand',
      'HeadObjectCommand',
      'GetObjectCommand',
      'HeadObjectCommand',
      'GetObjectCommand',
      'HeadObjectCommand',
    ]);
  });

  it('list follows every page', async () => {
    const at = new Date('2026-12-31T00:00:00Z');
    const { client, sent } = fakeClient((_cmd, input) =>
      input.ContinuationToken === undefined
        ? { Contents: [{ Key: 'p/a', Size: 1, LastModified: at }], IsTruncated: true, NextContinuationToken: 't1' }
        : { Contents: [{ Key: 'p/b', Size: 2, LastModified: at }, { Size: 9 }], IsTruncated: false },
    );
    const store = createS3ObjectStore(CONFIG, client);
    expect(await store.list!('p/')).toEqual([
      { key: 'p/a', size: 1, lastModified: at.getTime() },
      { key: 'p/b', size: 2, lastModified: at.getTime() },
    ]);
    expect(sent.map((s) => [s.cmd, s.input.Prefix, s.input.ContinuationToken])).toEqual([
      ['ListObjectsV2Command', 'p/', undefined],
      ['ListObjectsV2Command', 'p/', 't1'],
    ]);
  });

  it('putMultipart: a body up to one part is one PutObject', async () => {
    const { client, sent } = fakeClient(() => ({}));
    const store = createS3ObjectStore(CONFIG, client);
    expect(await store.putMultipart!('k', bodyOf([4, 6]), 'application/octet-stream', 10)).toEqual({ size: 10 });
    expect(sent.map((s) => s.cmd)).toEqual(['PutObjectCommand']);
    expect((sent[0]!.input.Body as Buffer).length).toBe(10);
    expect(MULTIPART_PART_BYTES).toBe(16 * 1024 * 1024);
  });

  it('putMultipart: a longer body is create + equal parts + complete, with the part list', async () => {
    const { client, sent } = fakeClient((cmd, input) =>
      cmd === 'CreateMultipartUploadCommand' ? { UploadId: 'u1' } : cmd === 'UploadPartCommand' ? { ETag: `"e${String(input.PartNumber)}"` } : {},
    );
    const store = createS3ObjectStore(CONFIG, client);
    expect(await store.putMultipart!('k', bodyOf([7, 7, 7, 4]), 'application/octet-stream', 10)).toEqual({ size: 25 });
    expect(sent.map((s) => s.cmd)).toEqual([
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]);
    const parts = sent.filter((s) => s.cmd === 'UploadPartCommand');
    expect(parts.map((p) => [(p.input.Body as Buffer).length, p.input.PartNumber, p.input.UploadId])).toEqual([
      [10, 1, 'u1'],
      [10, 2, 'u1'],
      [5, 3, 'u1'],
    ]);
    const expected = Buffer.concat([Buffer.alloc(7, 1), Buffer.alloc(7, 2), Buffer.alloc(7, 3), Buffer.alloc(4, 4)]);
    expect(Buffer.concat(parts.map((p) => p.input.Body as Buffer)).equals(expected)).toBe(true);
    expect(sent.at(-1)!.input.MultipartUpload).toEqual({
      Parts: [
        { ETag: '"e1"', PartNumber: 1 },
        { ETag: '"e2"', PartNumber: 2 },
        { ETag: '"e3"', PartNumber: 3 },
      ],
    });
  });

  it('putMultipart: a failing part aborts the upload and rethrows the original error', async () => {
    const { client, sent } = fakeClient((cmd, input) =>
      cmd === 'CreateMultipartUploadCommand' ? { UploadId: 'u2' } : cmd === 'UploadPartCommand' && input.PartNumber === 2 ? new Error('part down') : {},
    );
    const store = createS3ObjectStore(CONFIG, client);
    await expect(store.putMultipart!('k', bodyOf([25]), 'application/octet-stream', 10)).rejects.toThrow('part down');
    expect(sent.map((s) => s.cmd)).toEqual(['CreateMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCommand', 'AbortMultipartUploadCommand']);
    expect(sent.at(-1)!.input).toEqual({ Bucket: 'b', Key: 'k', UploadId: 'u2' });
  });

  it('putMultipart: a failing source after the first part aborts too; before any part nothing is sent', async () => {
    const { client, sent } = fakeClient((cmd) => (cmd === 'CreateMultipartUploadCommand' ? { UploadId: 'u3' } : {}));
    const store = createS3ObjectStore(CONFIG, client);
    const broken = (bytes: number) =>
      Readable.from(
        (async function* () {
          yield Buffer.alloc(bytes);
          throw new Error('dump died');
        })(),
      );
    await expect(store.putMultipart!('k', broken(15), 'application/octet-stream', 10)).rejects.toThrow('dump died');
    expect(sent.map((s) => s.cmd)).toEqual(['CreateMultipartUploadCommand', 'UploadPartCommand', 'AbortMultipartUploadCommand']);
    sent.length = 0;
    await expect(store.putMultipart!('k', broken(5), 'application/octet-stream', 10)).rejects.toThrow('dump died');
    expect(sent).toEqual([]);
  });
});
