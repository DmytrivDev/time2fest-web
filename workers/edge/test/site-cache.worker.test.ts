// The public site address in a real workerd (wrangler's test harness): `caches.default`, local R2 and the
// red button behind the Worker entry (SPEC-08 AC-25, AC-28, AC-30, AC-38). Freshness timing lives in
// `public-cache.test.ts` (the harness cannot fake time). One harness per describe: a fresh harness is a
// fresh isolate (red-button memo) and an empty cache.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';
import { SITE_R2_KEYS } from '../../../packages/contracts/src/site';
import { UNAVAILABLE_BODY } from '../src/responses';
import { writeTempConfig, type TempConfig } from './support/tempConfig';

const SECRET = 's'.repeat(32); // check-secrets: allow test value
const PREFIX = 'edge_test/';
const SITE = '/api/site/state';
const CF = { country: 'UA' } as const;

function snapshot(version: number, extra: Record<string, unknown> = {}) {
  return {
    version,
    at: '2026-12-31T00:00:00.000Z',
    switches: {
      chat: true,
      toasts: true,
      pass: true,
      passGift: true,
      payments: true,
      viewersMap: true,
      viewersCount: true,
      passOffer: true,
      chatRooms: {},
      toastTiers: { '2': true, '5': true, '10': true },
    },
    products: [],
    catalogVersion: 'cat-1',
    eventPatches: {},
    ...extra,
  };
}

/** A loopback origin for the site address: a valid snapshot with `Set-Cookie`, or a tunnel-style 530. */
type SiteOrigin = { url: string; calls: number; up: boolean; version: number; close: () => Promise<void> };

async function startSiteOrigin(): Promise<SiteOrigin> {
  const origin = { calls: 0, up: true, version: 7 } as SiteOrigin;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if ((req.url ?? '').split('?')[0] !== SITE) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      origin.calls += 1;
      if (!origin.up) {
        res.writeHead(530, { 'content-type': 'text/html' });
        res.end('<html><body>error 1033</body></html>');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': ['sid=origin; Path=/; HttpOnly'],
      });
      res.end(JSON.stringify(snapshot(origin.version)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  origin.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return origin;
}

type Bucket = { put(key: string, value: string): Promise<unknown> };

/** One harness of env `test` with a local `SITE_BUCKET` and its own origin; closed after the describe. */
function useSiteHarness(tag: string) {
  const ref: { h?: TestHarness; cfg?: TempConfig; origin?: SiteOrigin } = {};
  beforeAll(async () => {
    ref.origin = await startSiteOrigin();
    ref.cfg = writeTempConfig(ref.origin.url, `site-${tag}`, { env: 'test', prefix: PREFIX });
    ref.h = createTestHarness({
      workers: [{ configPath: ref.cfg.configPath, env: 'test', secrets: { T2F_EDGE_SECRET: SECRET } }],
    });
    await ref.h.listen();
  });
  afterAll(async () => {
    await ref.h?.close();
    ref.cfg?.cleanup();
    await ref.origin?.close();
  });
  const need = <T>(v: T | undefined): T => {
    if (v === undefined) throw new Error('harness not started');
    return v;
  };
  return {
    origin: () => need(ref.origin),
    fetch: (path: string) => need(ref.h).fetch(path, { cf: CF }),
    bucket: async () => (await need(ref.h).getWorker<{ SITE_BUCKET: Bucket }>().getEnv()).SITE_BUCKET,
  };
}

type HarnessResponse = Awaited<ReturnType<TestHarness['fetch']>>;

async function expectSource(res: HarnessResponse, source: string, version: number, label: string) {
  const body = await res.text();
  expect(res.status, `${label}: ${body.slice(0, 200)}`).toBe(200);
  expect(res.headers.get('x-t2f-source'), label).toBe(source);
  expect(res.headers.get('x-t2f-site-version'), label).toBe(String(version));
  expect(res.headers.get('cache-control'), label).toBe('public, max-age=10');
  expect(res.headers.get('set-cookie'), label).toBeNull();
  expect((JSON.parse(body) as { version: number }).version, label).toBe(version);
}

describe('workerd: cache in front of the origin (AC-25, AC-30)', () => {
  const site = useSiteHarness('cache');

  it('AC-25: two requests within the fresh window → one origin call, the second from caches.default', async () => {
    await expectSource(await site.fetch(SITE), 'origin', 7, 'first');
    await expectSource(await site.fetch(SITE), 'cache', 7, 'second');
    expect(site.origin().calls).toBe(1);
  });

  it('AC-30: origin Set-Cookie never reaches the client, and the stored copy keeps serving', async () => {
    // The origin answers every call with `Set-Cookie`; the copy stored by the first test is still used.
    const res = await site.fetch(`${SITE}?bust=1`);
    await expectSource(res, 'cache', 7, 'query dropped, stored copy');
    expect(site.origin().calls).toBe(1);
  });
});

// Separate harnesses: the isolate memoises the R2 copy (also "absent") for 10 s (S8-03).
describe('workerd: origin failing, nothing anywhere (AC-29)', () => {
  const site = useSiteHarness('empty');

  it('nothing anywhere → the existing 503', async () => {
    site.origin().up = false;
    const res = await site.fetch(SITE);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE_BODY);
  });
});

describe('workerd: origin failing → R2 copy (AC-28)', () => {
  const site = useSiteHarness('r2');

  it('AC-28: empty cache + failing origin + R2 copy → the copy, x-t2f-source: r2', async () => {
    site.origin().up = false;
    // Put before the first request: the isolate memo has not read the bucket yet.
    await (await site.bucket()).put(`${PREFIX}${SITE_R2_KEYS.latest}`, JSON.stringify(snapshot(5)));
    await expectSource(await site.fetch(SITE), 'r2', 5, 'r2 copy');
  });
});

describe('workerd: red button wins over a working origin (AC-38)', () => {
  const site = useSiteHarness('red');

  it('AC-38: a valid red-button object → x-t2f-source: red-button, origin not asked', async () => {
    // Put before the first request: the isolate memo has not read the bucket yet.
    const button = snapshot(9, { outage: 'technical' });
    await (await site.bucket()).put(`${PREFIX}${SITE_R2_KEYS.redButton}`, JSON.stringify(button));
    await expectSource(await site.fetch(SITE), 'red-button', 9, 'red button');
    expect(site.origin().calls).toBe(0);
  });
});
