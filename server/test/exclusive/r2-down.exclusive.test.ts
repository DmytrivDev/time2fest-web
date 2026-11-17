/**
 * The R2 emulator stopped (AC-73, W34). Runs only under `pnpm --dir server test:int:exclusive`, which holds the
 * machine's exclusive integration lock: it stops and starts the shared `r2` container of the `t2f` compose
 * project. The catalog change stays committed, the copy is attempted again on the schedule (short delays are
 * injected) and, after the last failure, one `page` alarm is stored. The container is started again in `finally`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3ObjectStore } from '../../src/adapters/s3';
import { createCatalogR2Subscriber, settleCopies, type CatalogCopyDeps } from '../../src/catalog/copy';
import { catalogCopyDepsOf, payloadOf, startBackground } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from '../integration/catalog-helpers';
import { testDeps } from '../integration/helpers';
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
