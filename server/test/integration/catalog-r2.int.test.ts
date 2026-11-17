/**
 * The R2 copy of the catalog (AC-72, AC-73, AC-74, NFR-5, W34) against the emulator of the worktree stack:
 * a city rename puts both objects under this worktree's prefix within 60 s, the body equals what
 * `GET /api/catalog` returns; another prefix does not mix with it; a failing store is retried and then
 * pages; no log line carries the secret key. The stopped-emulator case is in `r2-down.exclusive.test.ts`.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3ObjectStore } from '../../src/adapters/s3';
import { copyCatalog, createCatalogR2Subscriber, settleCopies, type CatalogCopyDeps } from '../../src/catalog/copy';
import { readCatalog } from '../../src/catalog/service';
import { catalogCopyDepsOf, catalogStoreOf, payloadOf, startBackground } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import type { AlarmInput } from '../../src/ports';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';
import { deleteUnder, listKeys, r2Env, readObject, type R2Env } from './r2-helpers';

const run = `cr${Date.now()}`;
const OTHER = `other_${run}/`;

describe('catalog R2 copy', { timeout: 120_000 }, () => {
  const lines: string[] = [];
  const capture = {
    info: (f: Record<string, unknown>) => void lines.push(JSON.stringify(f)),
    warn: (f: Record<string, unknown>) => void lines.push(JSON.stringify(f)),
    error: (f: Record<string, unknown>) => void lines.push(JSON.stringify(f)),
  };
  let deps: Deps;
  let payload: Payload;
  let tiny: TinyCatalog;
  let env: R2Env;
  let copyDeps: CatalogCopyDeps;

  beforeAll(async () => {
    env = r2Env();
    deps = testDeps({ log: capture });
    payload = await payloadOf(deps)();
    tiny = await createTinyCatalog(payload, run);
    const resolved = catalogCopyDepsOf(deps);
    if (!resolved) throw new Error('r2: not configured');
    copyDeps = resolved;
    await deleteUnder(env, `${env.prefix}catalog/`);
  });

  afterAll(async () => {
    await deleteUnder(env, `${env.prefix}catalog/`);
    await deleteUnder(env, OTHER);
    await removeTinyCatalog(payload, run);
  });

  it('AC-72: a city rename puts latest.json and <version>.json, equal to the catalog endpoint body, within 60 s', async () => {
    const bus = await startBackground(deps, [createCatalogR2Subscriber(async () => copyDeps)]);
    try {
      await payload.update({ collection: 'cities', id: tiny.ids.cities, data: { name: { uk: 'Нова назва для R2' } } });
      const expected = await readCatalog(catalogStoreOf(deps));
      if (!expected.ok) throw new Error('catalog unavailable');
      const wanted = [`${env.prefix}catalog/${expected.value.version}.json`, `${env.prefix}catalog/latest.json`].sort();
      const deadline = Date.now() + 60_000;
      let keys: string[] = [];
      while (Date.now() < deadline) {
        keys = await listKeys(env, `${env.prefix}catalog/`);
        if (wanted.every((k) => keys.includes(k))) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      await settleCopies();
      expect(keys).toEqual(wanted);
      for (const key of wanted) expect(JSON.parse(await readObject(env, key))).toEqual(JSON.parse(JSON.stringify(expected.value)));
    } finally {
      await bus.stop();
    }
  });

  it('AC-74: the objects of another prefix are not listed under this prefix, and the other way round', async () => {
    const other = createS3ObjectStore({
      endpoint: String(process.env.T2F_R2_ENDPOINT),
      bucket: env.bucket,
      accessKeyId: String(process.env.T2F_R2_ACCESS_KEY_ID),
      secretAccessKey: String(process.env.T2F_R2_SECRET_ACCESS_KEY),
    });
    await other.put(`${OTHER}catalog/latest.json`, '{"other":true}', 'application/json');
    await copyCatalog({ ...copyDeps, schedule: [0] });
    const own = await listKeys(env, env.prefix);
    const foreign = await listKeys(env, OTHER);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((k) => k.startsWith(env.prefix))).toBe(true);
    expect(foreign).toEqual([`${OTHER}catalog/latest.json`]);
    expect(await readObject(env, `${OTHER}catalog/latest.json`)).toBe('{"other":true}');
  });

  it('AC-73: a failing store is retried on the schedule, then one page alarm; a success on a retry raises none', async () => {
    const raised: AlarmInput[] = [];
    const alarm = { raise: (a: AlarmInput) => void raised.push(a) };
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let calls = 0;
    const failing = {
      put: async () => {
        calls += 1;
        throw new Error('down');
      },
    };
    const failed = await copyCatalog({ ...copyDeps, objects: failing, alarm, sleep });
    expect(failed).toEqual({ ok: false, attempts: 4 });
    expect(waits).toEqual([30_000, 90_000, 180_000]);
    expect(calls).toBe(4);
    expect(raised).toEqual([{ level: 'page', source: 'catalog', code: 'catalog-r2-copy-failed', details: { attempts: 4 } }]);

    raised.length = 0;
    let n = 0;
    const flaky = {
      put: async (key: string, body: string, type: string) => {
        n += 1;
        if (n <= 2) throw new Error('flaky');
        await copyDeps.objects.put(key, body, type);
      },
    };
    const recovered = await copyCatalog({ ...copyDeps, objects: flaky, alarm, sleep });
    expect(recovered.ok).toBe(true);
    expect(recovered.attempts).toBe(3);
    expect(raised).toEqual([]);
  });

  it('NFR-5: no captured log line carries the secret access key', () => {
    const secret = String(process.env.T2F_R2_SECRET_ACCESS_KEY);
    expect(secret.length).toBeGreaterThan(8);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(secret);
  });
});
