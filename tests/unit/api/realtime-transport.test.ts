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
  constructor(readonly channel: string) {
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
  newSubscription(channel: string): FakeSubscription {
    if (this.subs.has(channel)) throw new Error(`duplicate subscription ${channel}`);
    const sub = new FakeSubscription(channel);
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
