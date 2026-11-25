/**
 * Client realtime transport C7 (SPEC-06, AC-42 … AC-53) against a fake Centrifugo client:
 * no network, no Docker; the fake records what the transport asks of the library.
 */
import { RealtimeTokenResponseSchema } from '@time2fest/contracts/schemas';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRealtimeTransport,
  retryAfterMs,
  STATE_INVALIDATED_CODE,
  type CentrifugeClientOptions,
  type CentrifugeModuleLike,
  type CentrifugeSubscriptionLike,
  type CentrifugeSubscriptionOptions,
  type RealtimeFetch,
  type RealtimeTokenResponse,
} from '@/lib/api/http/realtime/transport';
import type { ConnectionState, RealtimeListener } from '@/lib/api/http/realtime/types';

type Handler = (ctx: unknown) => void;

class Emitter {
  private readonly handlers = new Map<string, Handler[]>();
  on(event: string, listener: (ctx: never) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener as Handler]);
    return this;
  }
  emit(event: string, ctx: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(ctx);
  }
}

class FakeSubscription extends Emitter implements CentrifugeSubscriptionLike {
  subscribeCalls = 0;
  constructor(
    readonly channel: string,
    readonly options?: CentrifugeSubscriptionOptions,
  ) {
    super();
  }
  subscribe(): void {
    this.subscribeCalls += 1;
  }
}

class FakeCentrifuge extends Emitter {
  readonly subs = new Map<string, FakeSubscription>();
  readonly created: string[] = [];
  readonly tokensSet: string[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  constructor(
    readonly endpoint: string,
    readonly options: CentrifugeClientOptions,
  ) {
    super();
  }
  newSubscription(channel: string, options?: CentrifugeSubscriptionOptions): FakeSubscription {
    if (this.subs.has(channel)) throw new Error(`duplicate subscription ${channel}`);
    const sub = new FakeSubscription(channel, options);
    this.subs.set(channel, sub);
    this.created.push(channel);
    return sub;
  }
  removeSubscription(sub: CentrifugeSubscriptionLike | null): void {
    const fake = sub as FakeSubscription | null;
    if (fake && this.subs.get(fake.channel) === fake) this.subs.delete(fake.channel);
  }
  setToken(token: string): void {
    this.tokensSet.push(token);
  }
  connect(): void {
    this.connectCalls += 1;
    this.emit('state', { newState: 'connecting', oldState: 'disconnected' });
  }
  disconnect(): void {
    this.disconnectCalls += 1;
    this.emit('state', { newState: 'disconnected', oldState: 'connected' });
    this.emit('disconnected', { code: 0, reason: 'disconnect called' });
  }
  /** What the library does on a connect attempt: ask for a token, then report `connected`. */
  async connectWith(): Promise<string> {
    const token = await this.options.getToken();
    this.emit('state', { newState: 'connected', oldState: 'connecting' });
    return token;
  }
  sub(channel: string): FakeSubscription {
    const sub = this.subs.get(channel);
    if (!sub) throw new Error(`no subscription ${channel}`);
    return sub;
  }
}

function response(status: number, body: unknown): RealtimeTokenResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ANONYMOUS = { ok: true, value: { token: null, expiresAt: null } };
const SUBJECT = { ok: true, value: { token: 'fake-jwt', expiresAt: '2026-12-31T23:00:00.000Z' } }; // check-secrets: allow test fake

/** Deterministic `[0, 1)` source (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function harness(opts: { url?: string; random?: () => number; fetch?: RealtimeFetch } = {}) {
  const clients: FakeCentrifuge[] = [];
  class Centrifuge extends FakeCentrifuge {
    constructor(endpoint: string, options: CentrifugeClientOptions) {
      super(endpoint, options);
      clients.push(this);
    }
  }
  const library: CentrifugeModuleLike = { Centrifuge };
  const loadCentrifuge = vi.fn(async () => library);
  const fetch = vi.fn<RealtimeFetch>(opts.fetch ?? (async () => response(200, ANONYMOUS)));
  const transport = createRealtimeTransport({
    url: 'url' in opts ? opts.url : 'ws://rt.test/connection/websocket',
    tokenUrl: '/api/realtime/token',
    fetch,
    loadCentrifuge,
    random: opts.random ?? seeded(6),
  });
  const states: ConnectionState[] = [];
  transport.onStateChange((s) => states.push(s));
  const client = (): FakeCentrifuge => {
    const c = clients[0];
    if (!c || clients.length !== 1) throw new Error(`expected one client, got ${clients.length}`);
    return c;
  };
  return { transport, fetch, loadCentrifuge, clients, client, states };
}

function listener(): RealtimeListener & { events: RealtimeEnvelope[] } {
  const events: RealtimeEnvelope[] = [];
  return { events, onEvent: vi.fn((e: RealtimeEnvelope) => events.push(e)), onResync: vi.fn(), onForbidden: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('realtime transport — fake bodies are real C1 responses', () => {
  it('both token bodies pass the shared schema', () => {
    expect(RealtimeTokenResponseSchema.safeParse(ANONYMOUS).success).toBe(true);
    expect(RealtimeTokenResponseSchema.safeParse(SUBJECT).success).toBe(true);
  });
});

describe('AC-52 — no realtime URL', () => {
  it.each([undefined, ''])('url %j → disconnected, no import, no fetch', async (url) => {
    const h = harness({ url });
    const off = h.transport.subscribe('site:state', listener());
    await flush();
    expect(h.transport.state()).toBe('disconnected');
    expect(h.loadCentrifuge).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.states).toEqual([]);
    off();
    expect(h.transport.state()).toBe('disconnected');
  });
});

describe('AC-45 — lazy library and socket', () => {
  it('nothing is imported or connected before the first subscribe', async () => {
    const h = harness();
    await flush();
    expect(h.loadCentrifuge).not.toHaveBeenCalled();
    expect(h.clients).toHaveLength(0);
    expect(h.fetch).not.toHaveBeenCalled();

    h.transport.subscribe('site:state', listener());
    await flush();
    expect(h.loadCentrifuge).toHaveBeenCalledTimes(1);
    expect(h.client().connectCalls).toBe(1);
    expect(h.client().endpoint).toBe('ws://rt.test/connection/websocket');
  });

  it('a second channel reuses the loaded library and the open client', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    h.transport.subscribe('chat:UA', listener());
    await flush();
    expect(h.loadCentrifuge).toHaveBeenCalledTimes(1);
    expect(h.client().connectCalls).toBe(1);
    expect([...h.client().subs.keys()]).toEqual(['site:state', 'chat:UA']);
  });

  it('every listener leaving while the library loads → the client is created but never connects', async () => {
    const h = harness();
    const off = h.transport.subscribe('site:state', listener());
    off();
    await flush();
    expect(h.client().connectCalls).toBe(0);
    expect(h.client().subs.size).toBe(0);
    expect(h.transport.state()).toBe('disconnected');
  });
});

describe('AC-53 — reconnect delay bounds', () => {
  it('passes 500 / 20 000 ms to the client', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    expect(h.client().options).toMatchObject({ minReconnectDelay: 500, maxReconnectDelay: 20_000 });
  });
});

describe('AC-44 — one Centrifugo subscription per channel', () => {
  it('3 subscribes → 1 subscription; 3 unsubscribes → 0 and the connection closes', async () => {
    const h = harness();
    const offs = [listener(), listener(), listener()].map((l) => h.transport.subscribe('site:state', l));
    await flush();
    const c = h.client();
    expect(c.subs.size).toBe(1);
    expect(c.created).toEqual(['site:state']);
    expect(c.sub('site:state').subscribeCalls).toBe(1);

    offs[0]?.();
    offs[0]?.(); // a repeated call is a no-op
    offs[1]?.();
    expect(c.subs.size).toBe(1);
    expect(c.disconnectCalls).toBe(0);
    offs[2]?.();
    expect(c.subs.size).toBe(0);
    expect(c.disconnectCalls).toBe(1);
    expect(h.transport.state()).toBe('disconnected');
  });

  it('a listener added later reuses the subscription and receives events', async () => {
    const h = harness();
    const first = listener();
    h.transport.subscribe('site:state', first);
    await flush();
    const second = listener();
    h.transport.subscribe('site:state', second);
    h.client().sub('site:state').emit('publication', { data: { type: 'site', id: 'e1', version: 1 } });
    expect(h.client().created).toEqual(['site:state']);
    expect(first.events.map((e) => e.id)).toEqual(['e1']);
    expect(second.events.map((e) => e.id)).toEqual(['e1']);
  });

  it('subscribing again after the last unsubscribe reconnects the same client', async () => {
    const h = harness();
    const off = h.transport.subscribe('site:state', listener());
    await flush();
    off();
    h.transport.subscribe('site:state', listener());
    await flush();
    expect(h.loadCentrifuge).toHaveBeenCalledTimes(1);
    expect(h.client().connectCalls).toBe(2);
    expect(h.client().subs.size).toBe(1);
    expect(h.transport.state()).toBe('connecting');
  });
});

describe('AC-46 — batches are unpacked', () => {
  it('a batch of 3 → 3 onEvent calls in array order', async () => {
    const h = harness();
    const l = listener();
    h.transport.subscribe('chat:UA', l);
    await flush();
    h.client()
      .sub('chat:UA')
      .emit('publication', {
        data: {
          type: 'batch',
          id: 'b1',
          events: [
            { type: 'message', id: 'm1', data: { text: 'a' } },
            { type: 'message', id: 'm2', data: { text: 'b' } },
            { type: 'message', id: 'm3', data: { text: 'c' } },
          ],
        },
      });
    expect(l.onEvent).toHaveBeenCalledTimes(3);
    expect(l.events.map((e) => e.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('a payload that is not a C3 envelope reaches no listener', async () => {
    const h = harness();
    const l = listener();
    h.transport.subscribe('chat:UA', l);
    await flush();
    const sub = h.client().sub('chat:UA');
    sub.emit('publication', { data: 'text' });
    sub.emit('publication', { data: { id: 'x' } });
    expect(l.onEvent).not.toHaveBeenCalled();
  });
});

describe('AC-47 — connection state', () => {
  it('follows every transition of the state diagram', async () => {
    const h = harness();
    expect(h.transport.state()).toBe('disconnected');
    const offA = h.transport.subscribe('site:state', listener()); // disconnected → connecting
    await flush();
    const c = h.client();
    await c.connectWith(); // connecting → connected
    c.emit('state', { newState: 'connecting', oldState: 'connected' }); // drop, 3014 or 3005
    c.emit('state', { newState: 'connected', oldState: 'connecting' });
    offA(); // connected → disconnected (last unsubscribe)
    const offB = h.transport.subscribe('site:state', listener()); // disconnected → connecting
    await flush();
    offB(); // connecting → disconnected (last unsubscribe)
    expect(h.states).toEqual([
      'connecting',
      'connected',
      'connecting',
      'connected',
      'disconnected',
      'connecting',
      'disconnected',
    ]);
  });

  it('a client that stops on its own reports disconnected; a removed state listener hears nothing', async () => {
    const h = harness();
    const heard: ConnectionState[] = [];
    const offState = h.transport.onStateChange((s) => heard.push(s));
    h.transport.subscribe('site:state', listener());
    await flush();
    offState();
    h.client().emit('state', { newState: 'disconnected', oldState: 'connecting' });
    h.client().emit('disconnected', { code: 3501, reason: 'bad request' });
    expect(h.transport.state()).toBe('disconnected');
    expect(heard).toEqual(['connecting']);
  });
});

describe('AC-48 — token endpoint answers token:null', () => {
  it('the client gets an empty token (anonymous connect)', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    await expect(h.client().connectWith()).resolves.toBe('');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledWith('/api/realtime/token', { credentials: 'same-origin', cache: 'no-store' });
    expect(h.transport.state()).toBe('connected');
  });

  it('a subject token is passed through unchanged', async () => {
    const h = harness({ fetch: async () => response(200, SUBJECT) });
    h.transport.subscribe('site:state', listener());
    await flush();
    await expect(h.client().options.getToken()).resolves.toBe('fake-jwt'); // check-secrets: allow test fake
  });
});

describe('US-2, FR-RT-09 — anonymous reconnects never reach the token endpoint', () => {
  it('after token:null, reconnects reuse the anonymous answer without a request', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await expect(c.connectWith()).resolves.toBe('');
    for (let i = 0; i < 5; i += 1) {
      c.emit('state', { newState: 'connecting', oldState: 'connected' }); // a network drop
      c.emit('connecting', { code: 3, reason: 'transport closed' });
      await expect(c.connectWith()).resolves.toBe('');
    }
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.transport.state()).toBe('connected');
  });

  it('a state invalidation (3014) asks the endpoint again and picks up a new subject', async () => {
    let body: unknown = ANONYMOUS;
    const h = harness({ fetch: async () => response(200, body) });
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await expect(c.connectWith()).resolves.toBe('');
    body = SUBJECT;
    c.emit('connecting', { code: STATE_INVALIDATED_CODE, reason: 'state invalidated' });
    await expect(c.connectWith()).resolves.toBe('fake-jwt'); // check-secrets: allow test fake
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('a teardown forgets the anonymous answer: the next first subscribe asks again', async () => {
    const h = harness();
    const off = h.transport.subscribe('site:state', listener());
    await flush();
    await h.client().connectWith();
    off();
    h.transport.subscribe('site:state', listener());
    await flush();
    await h.client().connectWith();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('a subject token is never memoised: every getToken asks the endpoint', async () => {
    const h = harness({ fetch: async () => response(200, SUBJECT) });
    h.transport.subscribe('site:state', listener());
    await flush();
    await h.client().connectWith();
    await h.client().connectWith();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('AC-50 — token request failures are retried after 5–10 s', () => {
  function failingThenOk(first: () => Promise<RealtimeTokenResponse>): RealtimeFetch {
    let calls = 0;
    return async () => {
      calls += 1;
      return calls === 1 ? first() : response(200, ANONYMOUS);
    };
  }

  it.each([
    ['503', () => Promise.resolve(response(503, { ok: false, error: { code: 'unavailable' } }))],
    ['429', () => Promise.resolve(response(429, { ok: false, error: { code: 'rate_limited', retryAfterMs: 1000 } }))],
    ['network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('%s, then 200 → one retry inside [5 000; 10 000] ms, state stays connecting', async (_name, first) => {
    const h = harness({ fetch: failingThenOk(first) });
    h.transport.subscribe('site:state', listener());
    await flush();
    let token: string | undefined;
    void h.client()
      .options.getToken()
      .then((t) => (token = t));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.transport.state()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(10_000 - 4_999);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(token).toBe('');
    expect(h.transport.state()).toBe('connecting');
  });

  it.each([
    [0, 5_000],
    [0.999_999_9, 10_000],
  ])('random %d → pause of exactly %d ms', async (r, ms) => {
    const h = harness({ random: () => r, fetch: failingThenOk(async () => response(503, {})) });
    h.transport.subscribe('site:state', listener());
    await flush();
    void h.client().options.getToken();
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('the last unsubscribe during a pause stops the retries', async () => {
    const h = harness({ fetch: async () => response(503, {}) });
    const off = h.transport.subscribe('site:state', listener());
    await flush();
    const pending = h.client().options.getToken();
    const outcome = pending.then(
      () => 'resolved',
      () => 'rejected',
    );
    await flush();
    off();
    await expect(outcome).resolves.toBe('rejected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('S8-07 — token retries grow and honour Retry-After', () => {
  /** Times (ms since start) at which the token endpoint was asked, while it answers with `fail` forever. */
  async function askTimes(random: () => number, fail: () => RealtimeTokenResponse, horizon: number): Promise<number[]> {
    const start = Date.now();
    const times: number[] = [];
    const h = harness({
      random,
      fetch: async () => {
        times.push(Date.now() - start);
        return fail();
      },
    });
    h.transport.subscribe('site:state', listener());
    await flush();
    void h.client().options.getToken().catch(() => {});
    await vi.advanceTimersByTimeAsync(horizon);
    return times;
  }

  const gaps = (times: number[]) => times.slice(1).map((t, i) => t - (times[i] ?? 0));

  it('5xx forever: the first retry stays 10 s at most, later ones grow to the 45 s cap (random 1)', async () => {
    const times = await askTimes(() => 1, () => response(503, {}), 200_000);
    expect(gaps(times).slice(0, 6)).toEqual([10_000, 12_000, 24_000, 45_000, 45_000, 45_000]);
  });

  it('full jitter never goes below 5 s (random 0)', async () => {
    const times = await askTimes(() => 0, () => response(503, {}), 27_000);
    expect(gaps(times)).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it('429 with Retry-After: 30 → the next request not before 30 s', async () => {
    const tooMany = () => ({ ...response(429, {}), headers: new Headers({ 'Retry-After': '30' }) });
    const times = await askTimes(() => 0, tooMany, 65_000);
    expect(gaps(times)).toEqual([30_000, 30_000]);
  });

  it('429 with Retry-After: 600 → capped at 60 s', async () => {
    const tooMany = () => ({ ...response(429, {}), headers: new Headers({ 'Retry-After': '600' }) });
    const times = await askTimes(() => 0, tooMany, 125_000);
    expect(gaps(times)).toEqual([60_000, 60_000]);
  });

  it('429 with an unusable Retry-After → the grown delay', async () => {
    const tooMany = () => ({ ...response(429, {}), headers: new Headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }) });
    const times = await askTimes(() => 1, tooMany, 50_000);
    expect(gaps(times)).toEqual([10_000, 12_000, 24_000]);
  });

  it.each([
    ['30', 30_000],
    [' 2 ', 2_000],
    ['61', 60_000],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['soon', null],
    [null, null],
    [undefined, null],
  ])('retryAfterMs(%j) → %j', (value, ms) => {
    expect(retryAfterMs(value)).toBe(ms);
  });
});

describe('AC-51 — subscription refused with 103', () => {
  it('one onForbidden per listener, the subscription is removed and never retried', async () => {
    const h = harness();
    const personal = listener();
    const pub = listener();
    const offPersonal = h.transport.subscribe('user:p#g1', personal);
    h.transport.subscribe('site:state', pub);
    await flush();
    const c = h.client();
    const sub = c.sub('user:p#g1');
    sub.emit('unsubscribed', { code: 103, reason: 'permission denied' });

    expect(personal.onForbidden).toHaveBeenCalledTimes(1);
    expect(pub.onForbidden).not.toHaveBeenCalled();
    expect(c.subs.has('user:p#g1')).toBe(false);
    expect(sub.subscribeCalls).toBe(1);
    sub.emit('publication', { data: { type: 'x', id: 'late' } });
    expect(personal.onEvent).not.toHaveBeenCalled();
    offPersonal();
    expect(c.disconnectCalls).toBe(0);
    expect(c.created).toEqual(['user:p#g1', 'site:state']);
  });

  it('the only channel refused → the connection closes', async () => {
    const h = harness();
    h.transport.subscribe('user:p#g1', listener());
    await flush();
    h.client().sub('user:p#g1').emit('unsubscribed', { code: 103, reason: 'permission denied' });
    expect(h.client().disconnectCalls).toBe(1);
    expect(h.transport.state()).toBe('disconnected');
  });

  it('an unsubscribe of another code is not a refusal', async () => {
    const h = harness();
    const l = listener();
    h.transport.subscribe('site:state', l);
    await flush();
    h.client().sub('site:state').emit('unsubscribed', { code: 2502, reason: 'state invalidated' });
    expect(l.onForbidden).not.toHaveBeenCalled();
    expect(h.client().subs.has('site:state')).toBe(true);
  });
});

describe('AC-42 — recovery outcome (unit part)', () => {
  it('failed recovery → onResync exactly once per listener', async () => {
    const h = harness();
    const a = listener();
    const b = listener();
    h.transport.subscribe('site:state', a);
    h.transport.subscribe('site:state', b);
    await flush();
    h.client().sub('site:state').emit('subscribed', { wasRecovering: true, recovered: false });
    expect(a.onResync).toHaveBeenCalledTimes(1);
    expect(b.onResync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, true],
    [false, false],
  ])('wasRecovering %s, recovered %s → no resync', async (wasRecovering, recovered) => {
    const h = harness();
    const l = listener();
    h.transport.subscribe('site:state', l);
    await flush();
    h.client().sub('site:state').emit('subscribed', { wasRecovering, recovered });
    expect(l.onResync).not.toHaveBeenCalled();
  });
});

describe('AC-49 — a refresh without a subject (unit part)', () => {
  it('the client stopping as unauthorized → anonymous reconnect, state connecting', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    c.emit('state', { newState: 'disconnected', oldState: 'connected' });
    c.emit('disconnected', { code: 1, reason: 'unauthorized' });
    expect(h.transport.state()).toBe('connecting');
    await flush();
    expect(c.tokensSet).toEqual(['']);
    expect(c.connectCalls).toBe(2);
    await expect(c.connectWith()).resolves.toBe('');
    expect(h.transport.state()).toBe('connected');
    expect(h.states).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  });
});

describe('SPEC-12 W44 — a subscription with a token', () => {
  const VIEWERS = 'live:viewers';
  const viewerEvent = (id: string) => ({ data: { type: 'viewers', id, data: {} } });

  it('a tokened first subscribe creates the subscription with the token source', async () => {
    const h = harness();
    const getToken = vi.fn(async () => 'sub-token'); // check-secrets: allow test fake
    h.transport.subscribe(VIEWERS, listener(), { getToken });
    await flush();
    const sub = h.client().sub(VIEWERS);
    expect(sub.options?.getToken).toBeTypeOf('function');
    await expect(sub.options?.getToken?.()).resolves.toBe('sub-token');
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('tokenless → tokened → tokenless: one subscription at a time, the other listener keeps receiving', async () => {
    const h = harness();
    const plain = listener();
    h.transport.subscribe(VIEWERS, plain);
    await flush();
    const c = h.client();
    const first = c.sub(VIEWERS);
    expect(first.options).toBeUndefined();
    first.emit('publication', viewerEvent('v1'));

    const counted = listener();
    const offCounted = h.transport.subscribe(VIEWERS, counted, { getToken: async () => 'sub-token' }); // check-secrets: allow test fake
    const second = c.sub(VIEWERS);
    expect(second).not.toBe(first);
    expect(second.options?.getToken).toBeTypeOf('function');
    expect(second.subscribeCalls).toBe(1);
    expect(c.subs.size).toBe(1);
    // The removed subscription is silent; the new one reaches both listeners.
    first.emit('publication', viewerEvent('stale'));
    second.emit('publication', viewerEvent('v2'));
    expect(plain.events.map((e) => e.id)).toEqual(['v1', 'v2']);
    expect(counted.events.map((e) => e.id)).toEqual(['v2']);

    offCounted();
    const third = c.sub(VIEWERS);
    expect(third).not.toBe(second);
    expect(third.options).toBeUndefined();
    third.emit('publication', viewerEvent('v3'));
    expect(plain.events.map((e) => e.id)).toEqual(['v1', 'v2', 'v3']);
    expect(counted.events.map((e) => e.id)).toEqual(['v2']);
    expect(c.created).toEqual([VIEWERS, VIEWERS, VIEWERS]);
    expect(c.disconnectCalls).toBe(0);
  });

  it('a second tokened listener reuses the tokened subscription; its source takes over when the first leaves', async () => {
    const h = harness();
    const a = vi.fn(async () => 'token-a'); // check-secrets: allow test fake
    const b = vi.fn(async () => 'token-b'); // check-secrets: allow test fake
    const offA = h.transport.subscribe(VIEWERS, listener(), { getToken: a });
    await flush();
    h.transport.subscribe(VIEWERS, listener(), { getToken: b });
    const c = h.client();
    const sub = c.sub(VIEWERS);
    offA();
    expect(c.sub(VIEWERS)).toBe(sub);
    expect(c.created).toEqual([VIEWERS]);
    await expect(sub.options?.getToken?.()).resolves.toBe('token-b');
    expect(a).not.toHaveBeenCalled();
  });

  it('a token switch before the library loads subscribes once, with the token', async () => {
    const h = harness();
    const off = h.transport.subscribe(VIEWERS, listener());
    h.transport.subscribe(VIEWERS, listener(), { getToken: async () => 'sub-token' }); // check-secrets: allow test fake
    off();
    await flush();
    const c = h.client();
    expect(c.created).toEqual([VIEWERS]);
    expect(c.sub(VIEWERS).options?.getToken).toBeTypeOf('function');
  });

  it('a refused token (unsubscribed code 1) → tokenless again, listeners kept', async () => {
    const h = harness();
    const l = listener();
    h.transport.subscribe(VIEWERS, l, { getToken: async () => '' });
    await flush();
    const c = h.client();
    const tokened = c.sub(VIEWERS);
    tokened.emit('unsubscribed', { code: 1 });
    const plain = c.sub(VIEWERS);
    expect(plain).not.toBe(tokened);
    expect(plain.options).toBeUndefined();
    expect(plain.subscribeCalls).toBe(1);
    plain.emit('publication', viewerEvent('v1'));
    expect(l.events.map((e) => e.id)).toEqual(['v1']);
    expect(l.onForbidden).not.toHaveBeenCalled();
  });
});

describe('SPEC-10 W45a — renewToken after a change of the session owner (AC-31)', () => {
  /** An unsigned JWT-shaped fake whose payload carries `sub`. */
  function fakeJwt(sub: string): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'none' })}.${part({ sub })}.sig`;
  }
  function subjectBody(sub: string) {
    return { ok: true, value: { token: fakeJwt(sub), expiresAt: '2026-12-31T23:00:00.000Z' } };
  }

  it('the fake subject body is a real C1 response', () => {
    expect(RealtimeTokenResponseSchema.safeParse(subjectBody('u1')).success).toBe(true);
  });

  it('anonymous connection → one token request, reconnect with the token, channels kept', async () => {
    let body: unknown = ANONYMOUS;
    const h = harness({ fetch: async () => response(200, body) });
    const l = listener();
    h.transport.subscribe('site:state', l);
    await flush();
    const c = h.client();
    await expect(c.connectWith()).resolves.toBe('');
    const sub = c.sub('site:state');
    body = subjectBody('u1');
    await h.transport.renewToken();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(c.disconnectCalls).toBe(1);
    expect(c.tokensSet).toEqual([fakeJwt('u1')]);
    expect(c.connectCalls).toBe(2);
    expect(h.transport.state()).toBe('connecting');
    expect(h.clients).toHaveLength(1);
    expect(c.sub('site:state')).toBe(sub);
    c.emit('state', { newState: 'connected', oldState: 'connecting' });
    expect(h.transport.state()).toBe('connected');
    sub.emit('publication', { data: { type: 'site.state', id: 'e1', data: {} } });
    expect(l.events.map((e) => e.id)).toEqual(['e1']);
  });

  it('a renewal during a renewal → one request', async () => {
    let release: () => void = () => {};
    let calls = 0;
    const h = harness({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response(200, ANONYMOUS);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return response(200, subjectBody('u1'));
      },
    });
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    const first = h.transport.renewToken();
    const second = h.transport.renewToken();
    await flush();
    release();
    await Promise.all([first, second]);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(c.tokensSet).toEqual([fakeJwt('u1')]);
    expect(c.connectCalls).toBe(2);
  });

  it('the same subject → no reconnect; another subject → reconnect', async () => {
    let body: unknown = subjectBody('u1');
    const h = harness({ fetch: async () => response(200, body) });
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    await h.transport.renewToken();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(c.disconnectCalls).toBe(0);
    expect(c.tokensSet).toEqual([]);
    body = subjectBody('u2');
    await h.transport.renewToken();
    expect(c.disconnectCalls).toBe(1);
    expect(c.tokensSet).toEqual([fakeJwt('u2')]);
  });

  it('signed out (token:null after a subject) → anonymous reconnect; later reconnects ask nothing', async () => {
    let body: unknown = subjectBody('u1');
    const h = harness({ fetch: async () => response(200, body) });
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    body = ANONYMOUS;
    await h.transport.renewToken();
    expect(c.tokensSet).toEqual(['']);
    expect(c.connectCalls).toBe(2);
    await expect(c.connectWith()).resolves.toBe('');
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('anonymous stays anonymous → no reconnect, the anonymous answer is kept', async () => {
    const h = harness();
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    await h.transport.renewToken();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(c.disconnectCalls).toBe(0);
    await expect(c.connectWith()).resolves.toBe('');
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed renewal request drops the token: the client asks getToken again on reconnect', async () => {
    let status = 200;
    const h = harness({ fetch: async () => response(status, status === 200 ? ANONYMOUS : {}) });
    h.transport.subscribe('site:state', listener());
    await flush();
    const c = h.client();
    await c.connectWith();
    status = 503;
    await h.transport.renewToken();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(c.tokensSet).toEqual(['']);
    expect(c.connectCalls).toBe(2);
    status = 200;
    await expect(c.connectWith()).resolves.toBe('');
    expect(h.fetch).toHaveBeenCalledTimes(3);
  });

  it('no open connection → no request', async () => {
    const h = harness();
    await h.transport.renewToken();
    const off = h.transport.subscribe('site:state', listener());
    off();
    await h.transport.renewToken();
    expect(h.fetch).not.toHaveBeenCalled();
    const none = harness({ url: '' });
    await none.transport.renewToken();
    expect(none.fetch).not.toHaveBeenCalled();
  });

  it('the token is never logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      let body: unknown = ANONYMOUS;
      const h = harness({ fetch: async () => response(200, body) });
      h.transport.subscribe('site:state', listener());
      await flush();
      await h.client().connectWith();
      body = subjectBody('u1');
      await h.transport.renewToken();
      const token = fakeJwt('u1');
      for (const spy of spies) {
        for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(token);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
