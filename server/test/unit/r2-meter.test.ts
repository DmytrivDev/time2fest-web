/**
 * Облік операцій R2 (SPEC-13b AC-39, W23): клас A — запис, список, multipart (створення, частини, завершення),
 * видалення; клас B — читання й `head`; час останньої вдалої й невдалої операції за префіксом; drain/restore.
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMeteredObjectStore } from '../../src/adapters/meteredObjectStore';
import type { ObjectStore } from '../../src/catalog/ports';
import { createR2Meter, r2PrefixOf } from '../../src/ops/meter';

const P = 't2f-test/wt/';

function fakeInner(fail = new Set<string>()): ObjectStore {
  const check = async (op: string) => {
    if (fail.has(op)) throw new Error(`${op} down`);
  };
  return {
    put: async () => check('put'),
    delete: async () => check('delete'),
    get: async () => (await check('get'), null),
    head: async () => (await check('head'), { size: 1, etag: 'e' }),
    list: async () => (await check('list'), []),
    async putMultipart(_k, body) {
      let size = 0;
      for await (const c of body as AsyncIterable<Buffer>) size += c.length;
      await check('multipart');
      return { size };
    },
  };
}

function setup(fail?: Set<string>) {
  let t = 1_000;
  const clock = { now: () => t };
  const meter = createR2Meter();
  const store = createMeteredObjectStore(fakeInner(fail), meter, r2PrefixOf(P), clock);
  return { meter, store, tick: (ms: number) => void (t += ms) };
}

describe('R2 meter', () => {
  it('maps keys to prefixes under the environment prefix', () => {
    const of = r2PrefixOf(P);
    expect(of(`${P}catalog/latest.json`)).toBe('catalog');
    expect(of(`${P}site/prepared/technical.json`)).toBe('site');
    expect(of(`${P}live/chains.json`)).toBe('live');
    expect(of(`${P}backups/db/20261231T000000Z.dump.enc`)).toBe('backups');
    expect(of(`${P}other/x`)).toBe('other');
    expect(of('elsewhere/catalog/latest.json')).toBe('other');
  });

  it('counts class A and B exactly and keeps the last ok time per prefix', async () => {
    const { meter, store, tick } = setup();
    await store.put(`${P}catalog/latest.json`, '{}', 'application/json');
    tick(10);
    await store.put(`${P}site/latest.json`, '{}', 'application/json');
    tick(10);
    await store.list!(`${P}backups/db/`);
    await store.delete!(`${P}backups/db/a.dump.enc`);
    tick(10);
    await store.get!(`${P}live/chains.json`);
    await store.head!(`${P}backups/db/a.manifest.json`);
    const s = meter.snapshot();
    expect({ classA: s.classA, classB: s.classB }).toEqual({ classA: 4, classB: 2 });
    expect(s.prefixes).toEqual({
      catalog: { lastOkAt: 1_000, lastFailedAt: null },
      site: { lastOkAt: 1_010, lastFailedAt: null },
      live: { lastOkAt: 1_030, lastFailedAt: null },
      backups: { lastOkAt: 1_030, lastFailedAt: null },
      other: { lastOkAt: null, lastFailedAt: null },
    });
  });

  it('putMultipart: one PutObject up to a part, else create + parts + complete; a failure counts what was read', async () => {
    const { meter, store } = setup();
    const body = (n: number) => Readable.from([Buffer.alloc(n)]);
    await store.putMultipart!(`${P}backups/db/a.dump.enc`, body(10), 'application/octet-stream', 10);
    expect(meter.drain()).toEqual({ classA: 1, classB: 0 });
    await store.putMultipart!(`${P}backups/db/b.dump.enc`, body(25), 'application/octet-stream', 10);
    expect(meter.drain()).toEqual({ classA: 5, classB: 0 }); // create + 3 parts + complete

    const failing = setup(new Set(['multipart']));
    await expect(failing.store.putMultipart!(`${P}backups/db/c.dump.enc`, body(25), 'application/octet-stream', 10)).rejects.toThrow('multipart down');
    expect(failing.meter.drain()).toEqual({ classA: 3, classB: 0 }); // create + 2 full parts read
    expect(failing.meter.snapshot().prefixes.backups).toEqual({ lastOkAt: null, lastFailedAt: 1_000 });
  });

  it('a failed operation is counted, keeps its error and sets only the failed time', async () => {
    const { meter, store, tick } = setup(new Set(['put', 'get']));
    await expect(store.put(`${P}catalog/latest.json`, '{}', 'application/json')).rejects.toThrow('put down');
    tick(5);
    await expect(store.get!(`${P}catalog/latest.json`)).rejects.toThrow('get down');
    const s = meter.snapshot();
    expect([s.classA, s.classB]).toEqual([1, 1]);
    expect(s.prefixes.catalog).toEqual({ lastOkAt: null, lastFailedAt: 1_005 });
  });

  it('drain takes the unflushed delta once; restore puts a failed flush back; totals are untouched', async () => {
    const { meter, store } = setup();
    await store.put(`${P}catalog/a`, '1', 'text/plain');
    await store.get!(`${P}catalog/a`);
    const first = meter.drain();
    expect(first).toEqual({ classA: 1, classB: 1 });
    expect(meter.drain()).toEqual({ classA: 0, classB: 0 });
    meter.restore(first);
    await store.put(`${P}catalog/b`, '1', 'text/plain');
    expect(meter.drain()).toEqual({ classA: 2, classB: 1 });
    expect([meter.snapshot().classA, meter.snapshot().classB]).toEqual([2, 1]);
  });

  it('a store without the optional methods stays without them', () => {
    const meter = createR2Meter();
    const store = createMeteredObjectStore({ put: async () => undefined }, meter, r2PrefixOf(P), { now: () => 0 });
    expect(Object.keys(store)).toEqual(['put']);
  });
});
