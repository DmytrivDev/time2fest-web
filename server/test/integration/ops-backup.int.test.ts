/**
 * SPEC-13b W27: the backup job over the real Postgres (`pg_dump` 17: local or the stack's container), the s3mock
 * emulator and the `ops-tick` door. AC-40 — a tick at a backup slot makes one copy, a second tick of the slot is
 * idle; AC-41/AC-43 — `.dump.enc` (first bytes `T2FB1`, not `PGDMP`; decrypts back to a `PGDMP` dump) then
 * `.manifest.json` whose size and sha256 equal the object; the part size is lowered so the upload is multipart;
 * AC-51 — a `backup-runs` row.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@payloadcms/db-postgres';
import { createPayloadBackupFacts } from '../../src/adapters/payloadOps';
import { buildDispatcher, payloadOf } from '../../src/container';
import { backupSlotAt } from '../../src/domain/ops/schedule';
import type { Deps } from '../../src/endpoints/types';
import { decryptStream, keyIdOf, parseBackupKey } from '../../src/ops/backupFormat';
import { testDumpRunner } from '../support/pgDumpRunner';
import { post, testDeps } from './helpers';
import { deleteUnder, listKeys, r2Env, type R2Env } from './r2-helpers';

const TEST_BACKUP_KEY = 'dGVzdC1iYWNrdXAta2V5LW5vdC1yZWFsLTMyYnl0ZXM='; // check-secrets: allow test fake backup key
// s3mock (like S3) refuses parts under 5 MB except the last: 5 MB parts and a padding table of ~8 MB of
// incompressible text make the encrypted dump span two parts at least.
const PART_BYTES = 5 * 1024 * 1024;
const PADDING_TABLE = 't2f_test_backup_padding';

async function bytesOf(env: R2Env, key: string): Promise<Buffer> {
  const res = await env.client.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

describe('backup through the ops-tick door (W27)', { timeout: 180_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let env: R2Env;
  let backups: string;

  const padding = async (text: string) => {
    const db = (payload.db as unknown as { drizzle: { execute(q: unknown): Promise<unknown> } }).drizzle;
    await db.execute(sql.raw(text));
  };

  async function tick(now: number): Promise<{ result: string; key?: string; manifest?: Record<string, unknown> }> {
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(now).toISOString(), jobs: ['backup'] }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { value: { jobs: { backup: { result: string; key?: string; manifest?: Record<string, unknown> } } } }).value.jobs.backup;
  }

  beforeAll(async () => {
    env = r2Env();
    backups = `${env.prefix}backups/db/`;
    const facts = createPayloadBackupFacts(() => payloadOf(deps)());
    const dump = await testDumpRunner(String(process.env.DATABASE_URI), () => facts.serverVersion());
    deps = testDeps({ backupTuning: { dump, partBytes: PART_BYTES } }, { T2F_BACKUP_KEY: TEST_BACKUP_KEY });
    payload = await payloadOf(deps)();
    await deleteUnder(env, backups);
    await padding(`DROP TABLE IF EXISTS "${PADDING_TABLE}"`);
    await padding(`CREATE TABLE "${PADDING_TABLE}" ("id" int PRIMARY KEY, "fill" text NOT NULL)`);
    await padding(
      `INSERT INTO "${PADDING_TABLE}" SELECT g, (SELECT string_agg(md5(random()::text || g || i), '') FROM generate_series(1, 32) i) FROM generate_series(1, 16000) g`,
    );
    await payload.delete({ collection: 'backup-runs', where: { id: { exists: true } }, overrideAccess: true });
  });

  afterAll(async () => {
    await deps?.opsRunner?.stop();
    await deleteUnder(env, backups).catch(() => undefined);
    await padding(`DROP TABLE IF EXISTS "${PADDING_TABLE}"`).catch(() => undefined);
  });

  it('AC-40/41/43/51: one copy per slot, T2FB1 object then a manifest that matches it, a backup-runs row', async () => {
    const slot = backupSlotAt(Date.now());
    const now = slot.due + 30_000;
    const out = await tick(now);
    expect(out).toMatchObject({ result: 'ok' });

    const keys = await listKeys(env, backups);
    expect(keys).toHaveLength(2);
    const dumpKey = keys.find((k) => k.endsWith('.dump.enc'))!;
    const manifestKey = keys.find((k) => k.endsWith('.manifest.json'))!;
    expect(dumpKey).toMatch(new RegExp(`^${backups.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{8}T\\d{6}Z\\.dump\\.enc$`));
    expect(manifestKey).toBe(dumpKey.replace(/\.dump\.enc$/, '.manifest.json'));

    const body = await bytesOf(env, dumpKey);
    expect(body.subarray(0, 5).toString('ascii')).toBe('T2FB1');
    expect(body.includes(Buffer.from('PGDMP'))).toBe(false);
    // The lowered part size makes this a multipart upload (AC-43).
    expect(body.length).toBeGreaterThan(PART_BYTES);

    const manifest = JSON.parse((await bytesOf(env, manifestKey)).toString('utf8')) as Record<string, unknown>;
    const key = parseBackupKey(TEST_BACKUP_KEY);
    expect(manifest).toMatchObject({
      format: 'T2FB1',
      key: dumpKey,
      size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      keyId: keyIdOf(key),
      snapshotAt: new Date(now).toISOString(),
      pgVersion: 17,
    });
    expect(typeof manifest.lastMigration).toBe('string');
    expect((manifest.rowCounts as Record<string, number>).countries).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(manifest)).not.toContain(TEST_BACKUP_KEY);

    // The object decrypts back to a custom-format dump.
    const plain = await collect(Readable.from([body]).pipe(decryptStream(key, keyIdOf(key))));
    expect(plain.subarray(0, 5).toString('ascii')).toBe('PGDMP');

    const rows = await payload.find({ collection: 'backup-runs', overrideAccess: true, depth: 0 });
    expect(rows.docs).toHaveLength(1);
    expect(rows.docs[0]).toMatchObject({ key: dumpKey, result: 'ok', size: body.length, keyId: keyIdOf(key) });
    expect(rows.docs[0]!.kind === 'daily' || rows.docs[0]!.kind === 'hourly').toBe(true);

    // A second tick of the same slot makes no second copy.
    expect((await tick(now + 60_000)).result).toBe('idle');
    expect(await listKeys(env, backups)).toHaveLength(2);
  });
});
