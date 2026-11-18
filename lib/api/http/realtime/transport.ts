/**
 * Client realtime transport C7 over Centrifugo (SPEC-06, AC-41 … AC-54).
 * `centrifuge` is loaded only by the dynamic `import()` on the first `subscribe`, so it enters no page bundle.
 * Relative imports and `@time2fest/contracts` only: the server's integration tests import this file too.
 * The connection token lives only inside the Centrifugo client: never stored, never logged.
 */
import type { RealtimeBatch, RealtimeEnvelope, Unsubscribe } from '@time2fest/contracts';
import { createChannelFilter, type ChannelFilter } from './dedupe';
import type { ConnectionState, RealtimeListener, RealtimeTransport } from './types';

/** Reconnect bounds handed to the client; the library spreads the delay randomly between them (AC-53). */
export const MIN_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 20_000;
/** Pause before the next token request after a failed one (AC-50). */
export const TOKEN_RETRY_MIN_MS = 5_000;
export const TOKEN_RETRY_MAX_MS = 10_000;
/** Centrifugo error code of a refused subscription (AC-51). */
export const PERMISSION_DENIED_CODE = 103;
/** `disconnected` code of the client when a token refresh came back empty (AC-49). */
const CLIENT_UNAUTHORIZED_CODE = 1;
/** Centrifugo disconnect code of a state invalidation (C6, AC-35): the subject may have changed. */
export const STATE_INVALIDATED_CODE = 3014;

// --- The part of the `centrifuge` 5.x API the transport uses (the real module satisfies it structurally). ---

export interface CentrifugeSubscriptionLike {
  on(event: 'publication', listener: (ctx: { data: unknown }) => void): unknown;
  on(event: 'subscribed', listener: (ctx: { wasRecovering: boolean; recovered: boolean }) => void): unknown;
  on(event: 'unsubscribed', listener: (ctx: { code: number }) => void): unknown;
  subscribe(): void;
}

export interface CentrifugeClientLike {
  on(event: 'state', listener: (ctx: { newState: string }) => void): unknown;
  on(event: 'connecting', listener: (ctx: { code: number }) => void): unknown;
  on(event: 'disconnected', listener: (ctx: { code: number }) => void): unknown;
  newSubscription(channel: string): CentrifugeSubscriptionLike;
  removeSubscription(sub: CentrifugeSubscriptionLike | null): void;
  setToken(token: string): void;
  connect(): void;
  disconnect(): void;
}

export interface CentrifugeClientOptions {
  getToken: () => Promise<string>;
  minReconnectDelay: number;
  maxReconnectDelay: number;
}

export interface CentrifugeModuleLike {
  Centrifuge: new (endpoint: string, options: CentrifugeClientOptions) => CentrifugeClientLike;
}

// --- Injected effects. ---

export interface RealtimeTokenResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type RealtimeFetch = (
  input: string,
  init: { credentials: 'same-origin'; cache: 'no-store' },
) => Promise<RealtimeTokenResponse>;

export interface RealtimeTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RealtimeTransportOptions {
  /** WebSocket address of Centrifugo; empty or absent → the transport never touches the network (AC-52). */
  url?: string;
  /** Same-origin token endpoint C1. */
  tokenUrl: string;
  fetch?: RealtimeFetch;
  loadCentrifuge?: () => Promise<CentrifugeModuleLike>;
  /** `[0, 1)`, as `Math.random`. */
  random?: () => number;
  timers?: RealtimeTimers;
}

const defaultTimers: RealtimeTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

interface ListenerRecord {
  listener: RealtimeListener;
}

interface ChannelEntry {
  records: Set<ListenerRecord>;
  filter: ChannelFilter;
  sub: CentrifugeSubscriptionLike | null;
}

const RETRY = Symbol('retry');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnvelope(value: unknown): value is RealtimeEnvelope {
  return isRecord(value) && typeof value.type === 'string' && typeof value.id === 'string';
}

/** Envelopes of one publication, in array order (AC-46); anything not shaped like C3 yields nothing. */
export function envelopesOf(data: unknown): RealtimeEnvelope[] {
  if (isRecord(data) && data.type === 'batch') {
    const { events } = data as Partial<RealtimeBatch>;
    return Array.isArray(events) ? events.filter(isEnvelope) : [];
  }
  return isEnvelope(data) ? [data] : [];
}

/** `token` of a C1 body: `''` for `token:null` (anonymous, AC-48); `undefined` when the body is not C1. */
function tokenOf(body: unknown): string | undefined {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.value)) return undefined;
  const { token } = body.value;
  if (token === null) return '';
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** Calls every listener even when one throws; the first error is rethrown afterwards. */
function notifyAll<T>(items: Iterable<T>, call: (item: T) => void): void {
  let failure: { error: unknown } | undefined;
  for (const item of [...items]) {
    try {
      call(item);
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}

export function createRealtimeTransport(options: RealtimeTransportOptions): RealtimeTransport {
  const url = options.url ?? '';
  const { tokenUrl } = options;
  const fetchToken: RealtimeFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const loadCentrifuge = options.loadCentrifuge ?? (() => import('centrifuge'));
  const random = options.random ?? Math.random;
  const timers = options.timers ?? defaultTimers;

  const channels = new Map<string, ChannelEntry>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  /** Pending pauses; a teardown wakes them with `false`. */
  const pauses = new Set<{ handle: unknown; wake: (goOn: boolean) => void }>();
  let state: ConnectionState = 'disconnected';
  let client: CentrifugeClientLike | null = null;
  let loading = false;
  /** Bumped on every teardown, so a token loop of a finished connection stops. */
  let generation = 0;
  /**
   * The token endpoint answered `token:null` (AC-48). The client asks `getToken` before every reconnect while
   * its token is empty, so without this a reconnect storm of anonymous visitors would hit the origin
   * (US-2, FR-RT-09): reconnects stay anonymous without a request until a state invalidation (3014) or a
   * teardown — the next first `subscribe` asks again.
   */
  let anonymous = false;

  function setState(next: ConnectionState): void {
    if (next === state) return;
    state = next;
    notifyAll(stateListeners, (listener) => listener(next));
  }

  /** Random 5–10 s pause (AC-50); resolves `false` when the transport was torn down meanwhile. */
  function pause(): Promise<boolean> {
    const spread = TOKEN_RETRY_MAX_MS - TOKEN_RETRY_MIN_MS;
    const ms = TOKEN_RETRY_MIN_MS + Math.min(spread, Math.floor(random() * (spread + 1)));
    return new Promise((resolve) => {
      const pending = {
        handle: undefined as unknown,
        wake: (goOn: boolean) => {
          pauses.delete(pending);
          resolve(goOn);
        },
      };
      pending.handle = timers.setTimeout(() => pending.wake(true), ms);
      pauses.add(pending);
    });
  }

  async function requestToken(): Promise<string | typeof RETRY> {
    let response: RealtimeTokenResponse;
    try {
      response = await fetchToken(tokenUrl, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      return RETRY;
    }
    // Network errors, 5xx and 429 are retried (AC-50); so is any other refusal or a body that is not C1,
    // because a rejected `getToken` would make the client stop or back off on its own schedule.
    if (!response.ok) return RETRY;
    try {
      return tokenOf(await response.json()) ?? RETRY;
    } catch {
      return RETRY;
    }
  }

  /** `getToken` of the client: resolves only with a usable token (`''` = anonymous), never `UnauthorizedError`. */
  async function getToken(): Promise<string> {
    if (anonymous) return '';
    const started = generation;
    for (;;) {
      const token = await requestToken();
      if (token !== RETRY) {
        if (started === generation) anonymous = token === '';
        return token;
      }
      if (!(await pause()) || started !== generation) {
        // The connection was closed meanwhile; the client ignores the outcome of an aborted attempt.
        throw new Error('realtime transport stopped');
      }
    }
  }

  function forEachListener(entry: ChannelEntry, call: (listener: RealtimeListener) => void): void {
    notifyAll(entry.records, (record) => {
      if (entry.records.has(record)) call(record.listener);
    });
  }

  function attach(channel: string, entry: ChannelEntry, centrifuge: CentrifugeClientLike): void {
    const sub = centrifuge.newSubscription(channel);
    entry.sub = sub;
    const isCurrent = () => channels.get(channel) === entry;
    sub.on('publication', (ctx) => {
      if (!isCurrent()) return;
      for (const envelope of envelopesOf(ctx.data)) {
        if (!entry.filter.accept(envelope)) continue;
        forEachListener(entry, (listener) => listener.onEvent(envelope));
      }
    });
    sub.on('subscribed', (ctx) => {
      // Recovered publications arrive as ordinary ones (AC-41); a failed recovery is one resync per listener (AC-42).
      if (!isCurrent() || !ctx.wasRecovering || ctx.recovered) return;
      forEachListener(entry, (listener) => listener.onResync?.());
    });
    sub.on('unsubscribed', (ctx) => {
      if (!isCurrent() || ctx.code !== PERMISSION_DENIED_CODE) return;
      // Refused (AC-51): forget the channel so the client never subscribes to it again.
      channels.delete(channel);
      centrifuge.removeSubscription(sub);
      try {
        forEachListener(entry, (listener) => listener.onForbidden?.());
      } finally {
        if (channels.size === 0) teardown();
      }
    });
    sub.subscribe();
  }

  function createClient(module: CentrifugeModuleLike): CentrifugeClientLike {
    const centrifuge = new module.Centrifuge(url, {
      getToken,
      minReconnectDelay: MIN_RECONNECT_DELAY_MS,
      maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
    });
    centrifuge.on('state', (ctx) => {
      if (channels.size === 0) return;
      if (ctx.newState === 'connecting' || ctx.newState === 'connected') setState(ctx.newState);
    });
    centrifuge.on('connecting', (ctx) => {
      // The server invalidated the state: the subject may have changed, so the next token is asked for again.
      if (ctx.code === STATE_INVALIDATED_CODE) anonymous = false;
    });
    centrifuge.on('disconnected', (ctx) => {
      if (channels.size > 0 && ctx.code === CLIENT_UNAUTHORIZED_CODE) {
        // A refresh came back without a subject (AC-49): reconnect anonymously; public channels resume,
        // personal ones are refused with 103 → `onForbidden`.
        setState('connecting');
        void Promise.resolve().then(() => {
          if (channels.size === 0 || state !== 'connecting') return;
          centrifuge.setToken('');
          centrifuge.connect();
        });
        return;
      }
      setState('disconnected');
    });
    return centrifuge;
  }

  function load(): void {
    if (loading) return;
    loading = true;
    loadCentrifuge()
      .then((module) => {
        loading = false;
        if (client) return;
        const centrifuge = createClient(module);
        client = centrifuge;
        if (channels.size === 0) return;
        for (const [channel, entry] of channels) attach(channel, entry, centrifuge);
        centrifuge.connect();
      })
      .catch(async () => {
        loading = false;
        if (client || channels.size === 0) return;
        // The chunk did not load: try again after a pause, still `connecting`.
        if ((await pause()) && !client && channels.size > 0) load();
      });
  }

  function start(): void {
    if (state !== 'disconnected') return;
    setState('connecting');
    if (client) client.connect();
    else load();
  }

  function teardown(): void {
    generation += 1;
    anonymous = false;
    for (const pending of [...pauses]) {
      timers.clearTimeout(pending.handle);
      pending.wake(false);
    }
    setState('disconnected');
    client?.disconnect();
  }

  return {
    subscribe(channel, listener): Unsubscribe {
      if (!url) return () => {};
      let entry = channels.get(channel);
      if (!entry) {
        entry = { records: new Set(), filter: createChannelFilter(), sub: null };
        channels.set(channel, entry);
        if (client) attach(channel, entry, client);
      }
      const record: ListenerRecord = { listener };
      entry.records.add(record);
      const owner = entry;
      start();

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        owner.records.delete(record);
        if (owner.records.size > 0 || channels.get(channel) !== owner) return;
        channels.delete(channel);
        if (owner.sub) client?.removeSubscription(owner.sub);
        if (channels.size === 0) teardown();
      };
    },
    state: () => state,
    onStateChange(listener): Unsubscribe {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
}
