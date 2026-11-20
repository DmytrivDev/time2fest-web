/**
 * Адаптер `http` домену `site` (SPEC-08, AC-45 … AC-51): підробні fetch і транспорт realtime, фальшиві таймери.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import type { SiteEvent, SiteService, SiteState } from '@/lib/api/contracts/site';
import { reduceSite, siteState } from '@/lib/api/hooks/site';
import { createHttpSite, SITE_STATE_URL, type SiteFetch, type SiteFetchResponse } from '@/lib/api/http/site';
import type { ConnectionState, RealtimeListener, RealtimeTransport } from '@/lib/api/http/realtime/types';
import { fail, ok } from '@/lib/api/result';
import { setServicesForTest } from '@/lib/api/services';
import { buildSnapshot } from '@/lib/api/site/buildSnapshot';
import { httpFactories } from '@/lib/api/http';
import { getData } from '@/lib/data/load';

const build = () => buildSnapshot(getData().meta);

const make = (version: number, extra: Partial<SiteState> = {}): SiteState => ({
  version,
  at: new Date(version * 1000).toISOString(),
  switches: {
    chat: true,
    toasts: true,
    pass: true,
    passGift: true,
    payments: true,
    viewersMap: true,
    passOffer: true,
    chatRooms: {},
    toastTiers: { '2': true, '5': true, '10': true },
  },
  products: [],
  catalogVersion: 'a+b',
  eventPatches: {},
  ...extra,
});

const answer = (status: number, body: unknown): SiteFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** fetch, що віддає наступну відповідь з черги (останню — повторно). */
function fetchQueue(...items: Array<SiteFetchResponse | Error | Promise<SiteFetchResponse>>) {
  const queue = [...items];
  return vi.fn<SiteFetch>(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (!next) throw new Error('no answer');
    return next;
  });
}

function fakeTransport(initial: ConnectionState) {
  let state = initial;
  const listeners: RealtimeListener[] = [];
  const stateListeners = new Set<(s: ConnectionState) => void>();
  const transport: RealtimeTransport = {
    subscribe(channel, listener) {
      expect(channel).toBe('site:state');
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    state: () => state,
    onStateChange(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
  };
  return {
    transport,
    listeners,
    emit: (e: RealtimeEnvelope) => listeners.forEach((l) => l.onEvent(e)),
    resync: () => listeners.forEach((l) => l.onResync?.()),
    setState(s: ConnectionState) {
      state = s;
      stateListeners.forEach((l) => l(s));
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function collect(svc: SiteService) {
  const events: SiteEvent[] = [];
  const off = svc.subscribe((e) => events.push(e));
  return { events, off, versions: () => events.map((e) => e.state.version) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('state() — GET /api/site/state', () => {
  it('reads the public address without cookies and returns the parsed snapshot', async () => {
    const fetch = fetchQueue(answer(200, make(4)));
    const svc = createHttpSite({ fetch, loadTransport: null, prelaunch: false });
    const r = await svc.state();
    expect(fetch).toHaveBeenCalledWith(SITE_STATE_URL, { credentials: 'omit' });
    expect(r).toEqual(ok(make(4)));
    expect(svc.peek()).toEqual(make(4));
  });

  it.each([
    ['503', answer(503, { ok: false, error: { code: 'unavailable', retryAfterMs: 5000 } }), 'unavailable'],
    ['a body that fails the schema', answer(200, { ...make(4), version: 0 }), 'unavailable'],
    ['a network error', new TypeError('Failed to fetch'), 'network'],
  ] as const)('%s → %s, nothing applied', async (_name, item, code) => {
    const svc = createHttpSite({ fetch: fetchQueue(item), loadTransport: null, prelaunch: false });
    const r = await svc.state();
    expect(r).toMatchObject({ ok: false, error: { code } });
    expect(svc.peek()).toBeUndefined();
  });

  it('AC-46: a snapshot older than the applied one is dropped (state() returns the applied one)', async () => {
    const svc = createHttpSite({ fetch: fetchQueue(answer(200, make(5)), answer(200, make(3))), loadTransport: null, prelaunch: false });
    await svc.state();
    const r = await svc.state();
    expect(r.ok && r.value.version).toBe(5);
  });
});

describe('AC-45 — events of site:state', () => {
  it('applies snapshot events that pass the schema; ignores clock, unknown types and broken data', async () => {
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch: fetchQueue(answer(200, make(1))), loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    t.emit({ type: 'clock', id: 'clock:1', data: { at: 1 } });
    t.emit({ type: 'whatever', id: 'x:1', data: make(9) });
    t.emit({ type: 'snapshot', id: 'site:7', version: 7, data: { ...make(7), switches: { chat: 'yes' } } });
    t.emit({ type: 'snapshot', id: 'site:8', version: 8 });
    expect(c.events).toEqual([]);
    t.emit({ type: 'snapshot', id: 'site:6', version: 6, data: make(6, { switches: { ...make(6).switches, chat: false } }) });
    expect(c.versions()).toEqual([6]);
    expect(svc.peek()?.switches.chat).toBe(false);
    c.off();
  });

  it('AC-46: an event during the load wins over the older answer; an older event after it is dropped', async () => {
    let release!: (r: SiteFetchResponse) => void;
    const pending = new Promise<SiteFetchResponse>((r) => (release = r));
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch: vi.fn<SiteFetch>(() => pending), loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    const loading = svc.state();
    t.emit({ type: 'snapshot', id: 'site:6', version: 6, data: make(6) });
    release(answer(200, make(5)));
    const r = await loading;
    expect(r.ok && r.value.version).toBe(6);
    t.emit({ type: 'snapshot', id: 'site:4', version: 4, data: make(4) });
    expect(c.versions()).toEqual([6]);
    c.off();
  });

  it('AC-47: an outage snapshot (v1) after v50 is applied, then the first normal one (v51) removes it', async () => {
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch: fetchQueue(answer(200, make(50))), loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    await svc.state();
    t.emit({ type: 'snapshot', id: 'site:1', version: 1, data: make(1, { outage: 'technical' }) });
    expect(svc.peek()?.outage).toBe('technical');
    t.emit({ type: 'snapshot', id: 'site:51', version: 51, data: make(51) });
    expect(svc.peek()).toEqual(make(51));
    expect(c.versions()).toEqual([50, 1, 51]);
    c.off();
  });
});

describe('re-reading the snapshot (AC-48 … AC-50)', () => {
  async function pollsAt(svc: SiteService, fetch: ReturnType<typeof fetchQueue>, ms: number) {
    const c = collect(svc);
    await flush();
    await vi.advanceTimersByTimeAsync(ms - 1_000);
    const early = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    const atMs = fetch.mock.calls.length;
    c.off();
    return { early, atMs };
  }

  it('AC-48: no realtime in the build → a request every 15 s', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const svc = createHttpSite({ fetch, loadTransport: null, prelaunch: false });
    const c = collect(svc);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(c.versions()).toEqual([2]);
    c.off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('AC-48: transport disconnected → a request at 15 s (±1)', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const t = fakeTransport('disconnected');
    const svc = createHttpSite({ fetch, loadTransport: async () => t.transport, prelaunch: false });
    expect(await pollsAt(svc, fetch, 15_000)).toEqual({ early: 0, atMs: 1 });
  });

  it('AC-48: the transport fails to load → still every 15 s', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const svc = createHttpSite({ fetch, loadTransport: () => Promise.reject(new Error('chunk')), prelaunch: false });
    expect(await pollsAt(svc, fetch, 15_000)).toEqual({ early: 0, atMs: 1 });
  });

  it('AC-49: connected without events → a request by the 30th second, none at 15 s', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch, loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    c.off();
  });

  it('AC-48: connected → disconnected switches to 15 s from that moment', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch, loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    t.setState('disconnected');
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    c.off();
  });

  it('AC-50: onResync → an immediate request', async () => {
    const fetch = fetchQueue(answer(200, make(3)));
    const t = fakeTransport('connected');
    const svc = createHttpSite({ fetch, loadTransport: async () => t.transport, prelaunch: false });
    const c = collect(svc);
    await flush();
    t.resync();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(c.versions()).toEqual([3]);
    c.off();
  });

  it('AC-51: a failed re-read keeps the last applied snapshot and emits nothing', async () => {
    const fetch = fetchQueue(answer(200, make(4)), answer(503, {}), new TypeError('offline'));
    const svc = createHttpSite({ fetch, loadTransport: null, prelaunch: false });
    await svc.state();
    const c = collect(svc);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(c.events).toEqual([]);
    expect(svc.peek()).toEqual(make(4));
    c.off();
  });
});

describe('AC-51 — the hook without any applied snapshot', () => {
  function serviceFailing(previous?: SiteState): SiteService {
    return { state: async () => fail('network'), subscribe: () => () => {}, peek: () => previous };
  }

  async function loaded(svc: SiteService) {
    const restore = setServicesForTest({ site: svc });
    const off = siteState.subscribe(() => {});
    await flush();
    const data = siteState.getSnapshot().data;
    off();
    restore();
    return data;
  }

  it('failure and nothing applied → the build snapshot', async () => {
    expect(await loaded(serviceFailing())).toEqual(build());
  });

  it('the build snapshot never blocks the server: the first server snapshot (even version 1) replaces it', async () => {
    let emit: ((e: SiteEvent) => void) | undefined;
    const svc: SiteService = {
      state: async () => fail('network'),
      subscribe: (cb) => {
        emit = cb;
        return () => (emit = undefined);
      },
      peek: () => undefined,
    };
    const restore = setServicesForTest({ site: svc });
    const off = siteState.subscribe(() => {});
    await flush();
    expect(siteState.getSnapshot().data).toEqual(build());
    const server = make(1, { switches: { ...make(1).switches, chat: false } });
    emit?.({ type: 'snapshot', state: server });
    expect(siteState.getSnapshot().data).toBe(server);
    // After that, the usual rule: an older server snapshot loses.
    emit?.({ type: 'snapshot', state: make(1) });
    expect(siteState.getSnapshot().data).toBe(server);
    off();
    restore();
  });

  it('reduceSite on a server snapshot is applySiteEvent', () => {
    const cur = make(5);
    expect(reduceSite(cur, { type: 'snapshot', state: make(4) })).toBe(cur);
    expect(reduceSite(cur, { type: 'snapshot', state: make(6) })).toEqual(make(6));
  });

  it('failure with a previous snapshot → that snapshot', async () => {
    expect(await loaded(serviceFailing(make(9)))).toEqual(make(9));
  });
});

describe('prelaunch build (А-3)', () => {
  it('serves the build snapshot with no request and no timer', async () => {
    const fetch = fetchQueue(answer(200, make(2)));
    const load = vi.fn(async () => fakeTransport('connected').transport);
    const svc = createHttpSite({ fetch, loadTransport: load, prelaunch: true, buildSnapshot: build });
    expect(svc.peek()).toEqual(build());
    const c = collect(svc);
    expect(await svc.state()).toEqual(ok(build()));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    c.off();
  });

  it('serves exactly the injected build snapshot (the adapter reads no data itself)', async () => {
    const own = make(1, { catalogVersion: 'injected+1' });
    const svc = createHttpSite({ fetch: fetchQueue(), loadTransport: null, prelaunch: true, buildSnapshot: () => own });
    expect(svc.peek()).toBe(own);
    expect(await svc.state()).toEqual(ok(own));
  });

  it('refuses a prelaunch build without a build snapshot provider', () => {
    expect(() => createHttpSite({ loadTransport: null, prelaunch: true })).toThrow(/buildSnapshot/);
  });

  it('the composition point injects the build snapshot of the bundled catalog', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRELAUNCH', '1');
    try {
      const factory = httpFactories.site;
      if (!factory) throw new Error('no http site factory');
      const svc = factory();
      expect(svc.peek()).toEqual(build());
      expect(await svc.state()).toEqual(ok(build()));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
