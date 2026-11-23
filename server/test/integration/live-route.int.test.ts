/**
 * `GET /api/live/chains` on the worktree's test database (SPEC-12 AC-3, AC-10, AC-11 server half; W25). Requests go
 * through the real dispatcher of `test`-class deps built by `createDeps`, so the composition root's live wiring answers:
 * the catalog events with their corrections and the stored sources.
 * - AC-3: with a session cookie → 200, the body passes `ChainsResponseSchema`, one chain per catalog event with stored
 *   sources (a source of an event outside the catalog gives none), `Cache-Control` exactly `public, max-age=10`, no
 *   `Set-Cookie`, the same body as `readChains` at the server clock.
 * - AC-10: the `hidden` correction of the event → its chain is absent.
 * - AC-11: random query parameters are ignored (the same body as without them).
 * Only ids of `data/streams.json` as video ids; no network: no poller runs.
 */
import { createLocalReq, type Payload } from 'payload';
import { ChainsResponseSchema } from '@time2fest/contracts/schemas';
import type { ChainsResponse } from '@time2fest/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf } from '../../src/container';
import { saveCorrection } from '../../src/corrections/service';
import { correctionsOf, liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { readChains } from '../../src/live/snapshot';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { BASE, testDeps } from './helpers';

const run = `lr${Date.now()}`;
const SYSTEM = { kind: 'system' as const, id: 'live-route', label: 'live-route' };
const PATH = '/api/live/chains';

type Dispatch = (r: Request) => Promise<Response>;

let deps: Deps;
let payload: Payload;
let live: LiveWiring;
let dispatch: Dispatch;
let tiny: TinyCatalog;

async function addSource(row: Record<string, unknown>): Promise<void> {
  await payload.create({
    collection: 'stream-sources',
    data: {
      platform: 'youtube',
      order: 0,
      status: 'live',
      embeddable: true,
      privacyStatus: 'public',
      ytFetchedAt: new Date(deps.clock.now()).toISOString(),
      ...row,
    } as never,
    overrideAccess: true,
  });
}

async function clean(): Promise<void> {
  await payload.delete({ collection: 'stream-sources', where: { id: { exists: true } }, overrideAccess: true });
}

async function chains(query = ''): Promise<{ res: Response; body: ChainsResponse }> {
  const res = await dispatch(new Request(`${BASE}${PATH}${query}`, { headers: { cookie: 'payload-token=abc; t2f_session=def', accept: 'application/json' } }));
  expect(res.status, await res.clone().text()).toBe(200);
  const raw = (await res.json()) as unknown;
  const parsed = ChainsResponseSchema.safeParse(raw);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return { res, body: raw as ChainsResponse };
}

beforeAll(async () => {
  deps = testDeps();
  payload = await payloadOf(deps)();
  live = liveOf(deps);
  dispatch = await buildDispatcher(deps);
  await clean();
  tiny = await createTinyCatalog(payload, run);
  await addSource({ sourceId: `src_${run}_1`, eventId: tiny.keys.event, videoId: 'zMCea32gpmg', order: 0 });
  await addSource({ sourceId: `src_${run}_2`, eventId: tiny.keys.event, videoId: 'MXmzsjABC-U', order: 1 });
  // A source of an event the catalog does not have: no chain for it.
  await addSource({ sourceId: `src_${run}_x`, eventId: `evt_nowhere_${run}`, videoId: 'Y6gzQmbSpEg' });
}, 120_000);

afterAll(async () => {
  if (!payload) return;
  await clean();
  await payload.delete({ collection: 'event-patches', where: { eventId: { like: run } }, overrideAccess: true, context: { t2fTrusted: true } });
  await removeTinyCatalog(payload, run);
});

describe('GET /api/live/chains', { timeout: 120_000 }, () => {
  it('AC-3: with a session cookie → 200, schema-valid bare body, one chain per event with sources, exact headers, no Set-Cookie', async () => {
    const { res, body } = await chains();
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('content-type')).toContain('application/json');
    expect('ok' in body).toBe(false);
    expect(body.chains.map((c) => c.eventId)).toEqual([tiny.keys.event]);
    expect(body.chains[0]?.sources.map((s) => s.id)).toEqual([`src_${run}_1`, `src_${run}_2`]);
    expect(body).toEqual(await readChains({ store: live.store, events: live.events, cfg: live.cfg }, deps.clock.now()));
  });

  it('AC-11: random query parameters are ignored — the same body as without them', async () => {
    const plain = (await chains()).body;
    const withParams = (await chains(`?version=7&utm_source=x&eventId=${tiny.keys.event}&r=${Math.random()}`)).body;
    expect(withParams).toEqual(plain);
  });

  it('AC-10: the hidden correction of the event → its chain is absent', async () => {
    const saved = await saveCorrection(
      correctionsOf(deps),
      await createLocalReq({ context: { t2fTrusted: true } }, payload),
      { changes: { [tiny.keys.event]: { hidden: true } }, expectedVersions: { [tiny.keys.event]: 0 }, confirmWarnings: true },
      SYSTEM,
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const { body } = await chains();
    expect(body.chains.map((c) => c.eventId)).not.toContain(tiny.keys.event);
  });
});
