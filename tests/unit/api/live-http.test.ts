/**
 * Адаптер `http` домену «Ефір» (SPEC-12, AC-16 … AC-20): підробні fetch і транспорт realtime, фальшиві таймери.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import type { ChainsResponse, StreamEvent, ViewerSummary } from '@/lib/api/contracts/live';
import {
  createHttpLive,
  LIVE_CHAINS_URL,
  LIVE_POLL_OFFLINE_MS,
  LIVE_POLL_ONLINE_MS,
  LIVE_SOURCE_ERRORS_URL,
  LIVE_VIEWERS_URL,
  type LiveFetch,
  type LiveFetchResponse,
} from '@/lib/api/http/live';
import { HTTP_DOMAINS } from '@/lib/api/http/domains';
import type { ConnectionState, RealtimeListener, RealtimeTransport } from '@/lib/api/http/realtime/types';
import { getData } from '@/lib/data/load';
import type { StreamChain } from '@/lib/data/types';

const data = getData();
const [eventId, chain] = [...data.chainsByEventId.entries()].find(([, c]) => c.sources.length > 1)!;
const first = chain.sources[0]!;
const other: StreamChain = [...data.chainsByEventId.values()].find((c) => c.eventId !== eventId)!;

const body = (version: number, chains: StreamChain[] = [chain, other]): ChainsResponse => ({
  version,
  at: new Date(version * 1000).toISOString(),
  chains: JSON.parse(JSON.stringify(chains)) as StreamChain[],
});

const answer = (status: number, json: unknown): LiveFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json,
});

/** fetch, що віддає наступну відповідь з черги (останню — повторно). */
function fetchQueue(...items: Array<LiveFetchResponse | Error>) {
  const queue = [...items];
  return vi.fn<LiveFetch>(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (!next) throw new Error('no answer');
    return next;
  });
}

function fakeTransport(initial: ConnectionState) {
  let state = initial;
  const listeners = new Map<string, RealtimeListener[]>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  const transport: RealtimeTransport = {
    subscribe(channel, listener) {
      const list = listeners.get(channel) ?? [];
      list.push(listener);
      listeners.set(channel, list);
      return () => list.splice(list.indexOf(listener), 1);
    },
    state: () => state,
    onStateChange(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
  };
  const on = (channel: string) => listeners.get(channel) ?? [];
  return {
    transport,
    on,
    emit: (channel: string, e: RealtimeEnvelope) => on(channel).forEach((l) => l.onEvent(e)),
    resync: () => on('live:streams').forEach((l) => l.onResync?.()),
    setState(s: ConnectionState) {
      state = s;
      stateListeners.forEach((l) => l(s));
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const chainsCalls = (f: ReturnType<typeof fetchQueue>) => f.mock.calls.filter(([url]) => url === LIVE_CHAINS_URL).length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('live http: читання', () => {
  it('AC-16: домен у HTTP_DOMAINS', () => {
    expect(HTTP_DOMAINS).toContain('live');
  });

  it('chains(): GET /api/live/chains без параметрів, без кук; тіло проходить схему', async () => {
    const f = fetchQueue(answer(200, body(3)));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    const r = await svc.chains();
    expect(f).toHaveBeenCalledWith(LIVE_CHAINS_URL, { credentials: 'omit' });
    expect(r.ok && r.value.version).toBe(3);
    expect(r.ok && r.value.chains.map((c) => c.eventId)).toEqual([eventId, other.eventId]);
  });

  it('chains(): бите тіло, 5xx і мережа — відмова', async () => {
    const svc = (a: LiveFetchResponse | Error) => createHttpLive({ fetch: fetchQueue(a), loadTransport: null, prelaunch: false });
    expect(await svc(answer(200, { version: 1, chains: [] })).chains()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await svc(answer(503, {})).chains()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await svc(new Error('offline')).chains()).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('viewers(): GET /api/live/viewers з people; бите тіло — відмова', async () => {
    const summary: ViewerSummary = { countries: [{ iso: 'UA', name: 'Україна', flagCode: 'ua' }], people: 7, at: '2026-12-31T20:00:00Z' };
    const f = fetchQueue(answer(200, summary), answer(200, { countries: 'x' }));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    expect(await svc.viewers()).toEqual({ ok: true, value: summary });
    expect(f).toHaveBeenCalledWith(LIVE_VIEWERS_URL, { credentials: 'omit' });
    expect((await svc.viewers()).ok).toBe(false);
  });

  it('reportSourceError(): POST JSON; 202 → ok, 400 → validation, 429 → rate_limited, мережа → network', async () => {
    const f = fetchQueue(answer(202, {}), answer(400, {}), answer(429, {}), new Error('offline'));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    const report = { eventId, sourceId: first.id, code: 150 as const };
    expect(await svc.reportSourceError(report)).toEqual({ ok: true, value: undefined });
    expect(f).toHaveBeenCalledWith(LIVE_SOURCE_ERRORS_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    expect(await svc.reportSourceError(report)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await svc.reportSourceError(report)).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(await svc.reportSourceError(report)).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('передстартова збірка: ланцюжки збірки, порожні глядачі, без мережі й таймерів', async () => {
    const f = fetchQueue(answer(200, body(1)));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: true, buildChains: () => [chain] });
    const r = await svc.chains();
    expect(r.ok && r.value.chains).toEqual([chain]);
    expect((await svc.viewers()).ok && (await svc.viewers())).toMatchObject({ value: { countries: [] } });
    const off = svc.subscribeStreams(() => undefined);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_ONLINE_MS * 2);
    off();
    expect(await svc.reportSourceError({ eventId, sourceId: first.id, code: 150 })).toEqual({ ok: true, value: undefined });
    expect(f).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('live http: канал live:streams (AC-16)', () => {
  it('chain, source, hide доходять; невідома й бита подія — ні', async () => {
    const rt = fakeTransport('connected');
    const svc = createHttpLive({ fetch: fetchQueue(answer(200, body(1))), loadTransport: async () => rt.transport, prelaunch: false });
    const seen: StreamEvent[] = [];
    const off = svc.subscribeStreams((e) => seen.push(e));
    await flush();
    const send = (data: unknown) => rt.emit('live:streams', { type: 'x', id: 'live:1:1', data });
    const ev: StreamEvent[] = [
      { type: 'chain', chain: { eventId, sources: [first] }, version: 2 },
      { type: 'source', eventId, source: { ...first, isLive: !first.isLive }, version: 3 },
      { type: 'hide', eventId, sourceId: first.id, version: 4 },
    ];
    ev.forEach(send);
    send({ type: 'clock', version: 5 });
    send({ type: 'hide', eventId, version: 6 });
    send({ type: 'source', eventId, source: { ...first, extra: 1 }, version: 7 });
    expect(seen).toEqual(ev);
    off();
    expect(rt.on('live:streams')).toHaveLength(0);
  });
});

describe('live http: перечитування (AC-19, AC-17, AC-20)', () => {
  it('без транспорту — кожні 15 с; зміни перечитаного — подіями chain з версією відповіді', async () => {
    const changed = { ...chain, sources: [first] };
    const f = fetchQueue(answer(200, body(1)), answer(200, body(1)), answer(200, body(2, [changed, other])));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    await svc.chains();
    const seen: StreamEvent[] = [];
    svc.subscribeStreams((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS - 1);
    expect(chainsCalls(f)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(chainsCalls(f)).toBe(2);
    expect(seen).toEqual([]); // та сама відповідь — нічого
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(chainsCalls(f)).toBe(3);
    expect(seen).toEqual([{ type: 'chain', chain: changed, version: 2 }]);
  });

  it('транспорт disconnected — кожні 15 с; connected без подій — кожні 30 с; onResync — одразу', async () => {
    const rt = fakeTransport('disconnected');
    const f = fetchQueue(answer(200, body(1)));
    const svc = createHttpLive({ fetch: f, loadTransport: async () => rt.transport, prelaunch: false });
    svc.subscribeStreams(() => undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(chainsCalls(f)).toBe(1);
    rt.setState('connected');
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS); // уже призначене перечитування
    expect(chainsCalls(f)).toBe(2);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_ONLINE_MS - 1);
    expect(chainsCalls(f)).toBe(2); // за connected крок — 30 с
    await vi.advanceTimersByTimeAsync(1);
    expect(chainsCalls(f)).toBe(3);
    rt.resync();
    await flush();
    expect(chainsCalls(f)).toBe(4);
    rt.setState('disconnected');
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(chainsCalls(f)).toBe(5);
  });

  it('старіша за застосовану відповідь — нічого; після події старіша відповідь теж нічого', async () => {
    const rt = fakeTransport('disconnected');
    const f = fetchQueue(answer(200, body(5)), answer(200, body(4, [other])));
    const svc = createHttpLive({ fetch: f, loadTransport: async () => rt.transport, prelaunch: false });
    await svc.chains();
    const seen: StreamEvent[] = [];
    svc.subscribeStreams((e) => seen.push(e));
    await flush();
    const hide: StreamEvent = { type: 'hide', eventId, sourceId: first.id, version: 6 };
    rt.emit('live:streams', { type: 'hide', id: 'live:6:1', data: hide });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(chainsCalls(f)).toBe(2);
    expect(seen).toEqual([hide]);
  });

  it('відмова перечитування лишає останнє застосоване (подій немає); наступна вдала — лише різниця', async () => {
    const changed = { ...other, sources: [] };
    const f = fetchQueue(answer(200, body(1)), new Error('offline'), answer(503, {}), answer(200, body(2, [chain, changed])));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    await svc.chains();
    const seen: StreamEvent[] = [];
    svc.subscribeStreams((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS * 2);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(seen).toEqual([{ type: 'chain', chain: changed, version: 2 }]);
  });

  it('зниклий з відповіді ланцюжок — подія chain з порожніми джерелами', async () => {
    const f = fetchQueue(answer(200, body(1)), answer(200, body(2, [chain])));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    await svc.chains();
    const seen: StreamEvent[] = [];
    svc.subscribeStreams((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(LIVE_POLL_OFFLINE_MS);
    expect(seen).toEqual([{ type: 'chain', chain: { eventId: other.eventId, sources: [] }, version: 2 }]);
  });

  it('остання відписка зупиняє таймер', async () => {
    const f = fetchQueue(answer(200, body(1)));
    const svc = createHttpLive({ fetch: f, loadTransport: null, prelaunch: false });
    const off = svc.subscribeStreams(() => undefined);
    off();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_ONLINE_MS * 2);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('live http: канал live:viewers', () => {
  it('агрегат, що проходить схему, доходить; битий — ні', async () => {
    const rt = fakeTransport('connected');
    const svc = createHttpLive({ fetch: fetchQueue(answer(200, {})), loadTransport: async () => rt.transport, prelaunch: false });
    const seen: ViewerSummary[] = [];
    const off = svc.subscribeViewers((s) => seen.push(s));
    await flush();
    const good: ViewerSummary = { countries: [], people: 3, at: '2026-12-31T20:00:00Z' };
    rt.emit('live:viewers', { type: 'viewers', id: 'viewers:1', data: good });
    rt.emit('live:viewers', { type: 'viewers', id: 'viewers:2', data: { people: -1 } });
    expect(seen).toEqual([good]);
    off();
    expect(rt.on('live:viewers')).toHaveLength(0);
  });
});
