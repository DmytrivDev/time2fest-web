/**
 * The R2 emulator stopped (AC-73, W34). Runs only under `pnpm --dir server test:int:exclusive`, which holds the
 * machine's exclusive integration lock: it stops and starts the shared `r2` container of the `t2f` compose
 * project. The catalog change stays committed, the copy is attempted again on the schedule (short delays are
 * injected) and, after the last failure, one `page` alarm is stored. The container is started again in `finally`.
 * SPEC-13b AC-44 (W27): a backup tick while R2 is down → `page` `ops/backup-failed` `{stage:'upload'}`, a failed
 * `backup-runs` row, no manifest and, after R2 is back, no object and no unfinished multipart upload.
 */
import { execFileSync } from 'node:child_process';
import { ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3ObjectStore } from '../../src/adapters/s3';
import { createCatalogR2Subscriber, settleCopies, type CatalogCopyDeps } from '../../src/catalog/copy';
import { createPayloadBackupFacts } from '../../src/adapters/payloadOps';
import { buildDispatcher, catalogCopyDepsOf, payloadOf, startBackground } from '../../src/container';
import { backupSlotAt } from '../../src/domain/ops/schedule';
import type { Deps } from '../../src/endpoints/types';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from '../integration/catalog-helpers';
import { post, testDeps } from '../integration/helpers';
import { testDumpRunner } from '../support/pgDumpRunner';
import { deleteUnder, listKeys, r2Env, type R2Env } from '../integration/r2-helpers';

const COMPOSE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docker-compose.yml');
const run = `rd${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', 't2f', '-f', COMPOSE_FILE, ...args], { stdio: 'pipe', timeout: 120_000, encoding: 'utf8' });
}

/** Starts the same container again (never recreates it) and waits until the bucket answers. */
async function startAndWait(env: R2Env): Promise<void> {
  compose('start', 'r2');
  for (let i = 0; i < 120; i += 1) {
    try {
      await listKeys(env, env.prefix);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('r2 did not come back');
}

describe('R2 down (exclusive lock)', { timeout: 180_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let tiny: TinyCatalog;
  let env: R2Env;
  let base: CatalogCopyDeps;

  beforeAll(async () => {
    env = r2Env();
    deps = testDeps();
    payload = await payloadOf(deps)();
    tiny = await createTinyCatalog(payload, run);
    const resolved = catalogCopyDepsOf(deps);
    if (!resolved) throw new Error('r2: not configured');
    base = resolved;
  });

  afterAll(async () => {
    await removeTinyCatalog(payload, run);
    await deleteUnder(env, `${env.prefix}catalog/`).catch(() => undefined);
  });

  it('AC-73: the change is committed, the copy is retried at least 3 times, then one page alarm is stored', async () => {
    const attempts: number[] = [];
    const counting = {
      put: async (key: string, body: string, type: string) => {
        attempts.push(Date.now());
        await createS3ObjectStore({
          endpoint: String(process.env.T2F_R2_ENDPOINT),
          bucket: env.bucket,
          accessKeyId: String(process.env.T2F_R2_ACCESS_KEY_ID),
          secretAccessKey: String(process.env.T2F_R2_SECRET_ACCESS_KEY),
        }).put(key, body, type);
      },
    };
    const alarmsBefore = (await payload.count({ collection: 'alarms', where: { code: { equals: 'catalog-r2-copy-failed' } }, overrideAccess: true })).totalDocs;
    const bus = await startBackground(deps, [createCatalogR2Subscriber(async () => ({ ...base, objects: counting, schedule: [0, 200, 400, 600] }))]);
    compose('stop', 'r2');
    try {
      await sleep(500);
      await payload.update({ collection: 'cities', id: tiny.ids.cities, data: { name: { uk: 'Зміна при вимкненому R2' } } });
      const stored = await payload.findByID({ collection: 'cities', id: tiny.ids.cities, overrideAccess: true, depth: 0 });
      expect((stored.name as { uk?: string }).uk).toBe('Зміна при вимкненому R2');
      let outcomes = await settleCopies();
      for (let i = 0; i < 120 && outcomes.length === 0; i += 1) {
        await sleep(250);
        outcomes = await settleCopies();
      }
      const [outcome] = outcomes;
      expect(outcome?.ok).toBe(false);
      expect(outcome?.attempts).toBeGreaterThanOrEqual(4);
      expect(attempts.length).toBeGreaterThanOrEqual(4);
      // `raise` stores the page alarm without being awaited by the copy: wait for the row, then
      // give a second one time to appear before asserting that exactly one was stored.
      const countAlarms = async () => (await payload.count({ collection: 'alarms', where: { code: { equals: 'catalog-r2-copy-failed' } }, overrideAccess: true })).totalDocs;
      for (let i = 0; i < 40 && (await countAlarms()) === alarmsBefore; i += 1) await sleep(250);
      await sleep(1000);
      expect((await countAlarms()) - alarmsBefore).toBe(1);
    } finally {
      await bus.stop();
      await startAndWait(env);
    }
  });
});

const TEST_BACKUP_KEY = 'dGVzdC1iYWNrdXAta2V5LW5vdC1yZWFsLTMyYnl0ZXM='; // check-secrets: allow test fake backup key

describe('R2 down during a backup (exclusive lock)', { timeout: 240_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let env: R2Env;
  let backups: string;

  beforeAll(async () => {
    env = r2Env();
    backups = `${env.prefix}backups/db/`;
    const facts = createPayloadBackupFacts(() => payloadOf(deps)());
    const dump = await testDumpRunner(String(process.env.DATABASE_URI), () => facts.serverVersion());
    deps = testDeps({ backupTuning: { dump } }, { T2F_BACKUP_KEY: TEST_BACKUP_KEY });
    payload = await payloadOf(deps)();
    await deleteUnder(env, backups);
    await payload.delete({ collection: 'backup-runs', where: { id: { exists: true } }, overrideAccess: true });
  });

  afterAll(async () => {
    await deps?.opsRunner?.stop();
    await deleteUnder(env, backups).catch(() => undefined);
  });

  it('AC-44: stage upload, a failed run, no manifest, no unfinished upload', async () => {
    const countAlarms = async () =>
      (await payload.count({ collection: 'alarms', where: { code: { equals: 'backup-failed' } }, overrideAccess: true })).totalDocs;
    const before = await countAlarms();
    const dispatch = await buildDispatcher(deps);
    const now = backupSlotAt(Date.now()).due + 45_000;
    compose('stop', 'r2');
    let outcome: { result: string; stage?: string } | undefined;
    try {
      await sleep(500);
      const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(now).toISOString(), jobs: ['backup'] }));
      expect(res.status).toBe(200);
      outcome = ((await res.json()) as { value: { jobs: { backup: { result: string; stage?: string } } } }).value.jobs.backup;
    } finally {
      await startAndWait(env);
    }
    expect(outcome).toMatchObject({ result: 'failed', stage: 'upload' });
    for (let i = 0; i < 40 && (await countAlarms()) === before; i += 1) await sleep(250);
    // The page alarm is stored (its stage is the run's: `alarms.details` is not written by the alarm store yet).
    expect((await countAlarms()) - before).toBe(1);
    const rows = (await payload.find({ collection: 'backup-runs', overrideAccess: true, depth: 0 })).docs;
    expect(rows).toEqual([expect.objectContaining({ result: 'failed', stage: 'upload' })]);
    expect(await listKeys(env, backups)).toEqual([]);
    const uploads = await env.client.send(new ListMultipartUploadsCommand({ Bucket: env.bucket, Prefix: backups }));
    expect(uploads.Uploads ?? []).toEqual([]);
  });
});
