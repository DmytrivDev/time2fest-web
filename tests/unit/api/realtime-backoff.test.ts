/**
 * Reconnect pauses of the realtime transport (SPEC-08 AC-59, AC-60): the pure functions and the transport that
 * schedules its own reconnects over a fake Centrifugo client (no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnectDelay, refusalDelay } from '@/lib/api/http/realtime/backoff';
import {
  createRealtimeTransport,
  isHandshakeRefusal,
  STATE_INVALIDATED_CODE,
  type CentrifugeClientOptions,
  type CentrifugeModuleLike,
  type CentrifugeSubscriptionLike,
  type RealtimeFetch,
  type RealtimeTokenResponse,
} from '@/lib/api/http/realtime/transport';

describe('AC-59 — reconnectDelay(n) is uniform in [1 500, min(45 000, 1 500·2ⁿ)]', () => {
  const ceilings = [1_500, 3_000, 6_000, 12_000, 24_000, 45_000, 45_000];
  it.each(ceilings.map((ceiling, n) => [n, ceiling] as const))('n = %d → random 0 gives 1 500, random 1 gives %d', (n, ceiling) => {
    expect(reconnectDelay(n, () => 0)).toBe(1_500);
    expect(reconnectDelay(n, () => 1)).toBe(ceiling);
  });

  it('random 0.5 at n = 3 is the middle of [1 500; 12 000]', () => {
    expect(reconnectDelay(3, () => 0.5)).toBe(6_750);
  });
});

describe('AC-60 — refusalDelay is uniform in [30 000, 60 000]', () => {
  it.each([
    [0, 30_000],
    [0.5, 45_000],
    [1, 60_000],
  ])('random %d → %d ms', (r, ms) => {
    expect(refusalDelay(() => r)).toBe(ms);
  });
});

// --- The transport over a fake client. ---

type Handler = (ctx: unknown) => void;

class FakeSubscription implements CentrifugeSubscriptionLike {
  on(): this {
    return this;
  }
  subscribe(): void {}
}

class FakeCentrifuge {
  private readonly handlers = new Map<string, Handler[]>();
  connectCalls = 0;
  disconnectCalls = 0;
  constructor(
    readonly endpoint: string,
    readonly options: CentrifugeClientOptions,
  ) {}
  on(event: string, listener: (ctx: never) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener as Handler]);
    return this;
  }
  emit(event: string, ctx: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(ctx);
  }
  newSubscription(): FakeSubscription {
    return new FakeSubscription();
  }
  removeSubscription(): void {}
  setToken(): void {}
  connect(): void {
    this.connectCalls += 1;
    this.emit('state', { newState: 'connecting' });
    this.emit('connecting', { code: 0, reason: 'connect called' });
  }
  disconnect(): void {
    this.disconnectCalls += 1;
    this.emit('state', { newState: 'disconnected' });
    this.emit('disconnected', { code: 0, reason: 'disconnect called' });
  }
  connected(): void {
    this.emit('state', { newState: 'connected' });
  }
  /** A drop of a live connection: the library moves to `connecting` and would retry on its own schedule. */
  drop(): void {
    this.emit('state', { newState: 'connecting' });
    this.emit('connecting', { code: 1, reason: 'transport closed' });
  }
}

function response(status: number, body: unknown): RealtimeTokenResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ANONYMOUS = { ok: true, value: { token: null, expiresAt: null } };

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function harness(opts: { random: () => number; fetch?: RealtimeFetch }) {
  const clients: FakeCentrifuge[] = [];
  class Centrifuge extends FakeCentrifuge {
    constructor(endpoint: string, options: CentrifugeClientOptions) {
      super(endpoint, options);
      clients.push(this);
    }
  }
  const library = { Centrifuge } as unknown as CentrifugeModuleLike;
  const fetch = vi.fn<RealtimeFetch>(opts.fetch ?? (async () => response(200, ANONYMOUS)));
  const transport = createRealtimeTransport({
    url: 'ws://rt.test/connection/websocket',
    tokenUrl: '/api/realtime/token',
    fetch,
    loadCentrifuge: async () => library,
    random: opts.random,
  });
  const off = transport.subscribe('site:state', { onEvent: () => {} });
  await flush();
  const client = clients[0];
  if (!client) throw new Error('no client');
  return { transport, fetch, client, off };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AC-59 — the transport reconnects after its own pause', () => {
  it('a drop stops the library retry and connects after reconnectDelay(0); each failed attempt grows n', async () => {
    const h = await harness({ random: () => 1 });
    h.client.connected();
    const before = h.client.connectCalls;
    h.client.drop();
    expect(h.client.disconnectCalls).toBe(1);
    expect(h.transport.state()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.client.connectCalls).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.connectCalls).toBe(before + 1);
    // The attempt fails: n = 1 → 3 000 ms with random 1.
    h.client.emit('error', { type: 'transport' });
    expect(h.client.disconnectCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(h.client.connectCalls).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.connectCalls).toBe(before + 2);
    // Connected again: n is back to 0.
    h.client.connected();
    h.client.drop();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.client.connectCalls).toBe(before + 3);
    expect(h.transport.state()).toBe('connecting');
  });

  it('the last unsubscribe during the pause cancels the reconnect', async () => {
    const h = await harness({ random: () => 0 });
    h.client.connected();
    h.client.drop();
    const calls = h.client.connectCalls;
    h.off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.client.connectCalls).toBe(calls);
    expect(h.transport.state()).toBe('disconnected');
  });
});

describe('SPEC-06 special codes keep their behaviour', () => {
  it('3014 (state invalidated): prompt reconnect after reconnectDelay(0) = 1 500 ms with a new token request, not 30–60 s', async () => {
    const h = await harness({ random: () => 0 });
    await expect(h.client.options.getToken()).resolves.toBe('');
    h.client.connected();
    const calls = h.client.connectCalls;
    h.client.emit('state', { newState: 'connecting' });
    h.client.emit('connecting', { code: STATE_INVALIDATED_CODE, reason: 'state invalidated' });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.client.connectCalls).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.connectCalls).toBe(calls + 1);
    await expect(h.client.options.getToken()).resolves.toBe('');
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([3501, 3503, 2])('a final disconnect %d that is not a refusal stays final (no retry)', async (code) => {
    const h = await harness({ random: () => 0 });
    const calls = h.client.connectCalls;
    h.client.emit('state', { newState: 'disconnected' });
    h.client.emit('disconnected', { code, reason: 'final' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.client.connectCalls).toBe(calls);
    expect(h.transport.state()).toBe('disconnected');
  });

  it('code 1 (refresh without a subject) still reconnects anonymously at once', async () => {
    const h = await harness({ random: () => 0 });
    h.client.connected();
    const calls = h.client.connectCalls;
    h.client.emit('state', { newState: 'disconnected' });
    h.client.emit('disconnected', { code: 1, reason: 'unauthorized' });
    await flush();
    expect(h.client.connectCalls).toBe(calls + 1);
  });

  it.each([
    [101, true],
    [103, true],
    [3500, true],
    [3507, true],
    [3501, false],
    [3014, false],
    [0, false],
    [1, false],
  ])('isHandshakeRefusal(%d) = %s', (code, refusal) => {
    expect(isHandshakeRefusal(code)).toBe(refusal);
  });
});

describe('AC-60 — a refusal waits 30–60 s', () => {
  it.each([
    [0, 30_000],
    [1, 60_000],
  ])('handshake refused (3500), random %d → next connect after %d ms', async (r, ms) => {
    const h = await harness({ random: () => r });
    const calls = h.client.connectCalls;
    h.client.emit('state', { newState: 'disconnected' });
    h.client.emit('disconnected', { code: 3500, reason: 'invalid token' });
    expect(h.transport.state()).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(h.client.connectCalls).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.connectCalls).toBe(calls + 1);
    expect(h.transport.state()).toBe('connecting');
  });

  it.each([
    [0, 30_000],
    [1, 60_000],
  ])('token request answered 403, random %d → next request after %d ms', async (r, ms) => {
    let calls = 0;
    const h = await harness({
      random: () => r,
      fetch: async () => {
        calls += 1;
        return calls === 1 ? response(403, { ok: false, error: { code: 'forbidden' } }) : response(200, ANONYMOUS);
      },
    });
    let token: string | undefined;
    void h.client.options.getToken().then((t) => (token = t));
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(token).toBe('');
  });
});
