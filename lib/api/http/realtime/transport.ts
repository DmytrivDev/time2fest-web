/**
 * Client realtime transport C7 over Centrifugo (SPEC-06, AC-41 … AC-54).
 * `centrifuge` is loaded only by the dynamic `import()` on the first `subscribe`, so it enters no page bundle.
 * Relative imports and `@time2fest/contracts` only: the server's integration tests import this file too.
 * The connection token lives only inside the Centrifugo client: never stored, never logged.
 */
import type { RealtimeBatch, RealtimeEnvelope, Unsubscribe } from '@time2fest/contracts';
import { reconnectDelay, refusalDelay } from './backoff';
import { createChannelFilter, type ChannelFilter } from './dedupe';
import type { ConnectionState, RealtimeListener, RealtimeTransport } from './types';

/**
 * Reconnect bounds handed to the client (SPEC-06 AC-53). Since SPEC-08 (AC-59) the transport schedules reconnects
 * itself (`./backoff`): on a drop or a failed attempt it stops the client and calls `connect()` after its own pause.
 * These bounds apply only to a retry the client starts without reporting it (no `connecting` / `error` event).
 */
export const MIN_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 20_000;
/** Pause before the next token request after a failed one (AC-50); a 4xx refusal other than 429 waits 30–60 s (AC-60). */
export const TOKEN_RETRY_MIN_MS = 5_000;
export const TOKEN_RETRY_MAX_MS = 10_000;
/**
 * Later token retries grow (S8-07): retry `n ≥ 1` waits uniform in [5 000, min(45 000, 1 500·2ⁿ⁺²)] ms
 * (`reconnectDelay`, full jitter); the first one stays 5–10 s (AC-50).
 */
const TOKEN_RETRY_GROWTH_OFFSET = 2;
/** Upper bound of a `Retry-After` the transport honours on a 429 (S8-07). */
export const TOKEN_RETRY_AFTER_MAX_MS = 60_000;
/** Centrifugo error code of a refused subscription (AC-51). */
export const PERMISSION_DENIED_CODE = 103;
/** `disconnected` code of the client when a token refresh came back empty (AC-49). */
const CLIENT_UNAUTHORIZED_CODE = 1;
/** `unsubscribed` code of a subscription whose token came back empty or expired without a refresh. */
const SUBSCRIPTION_UNAUTHORIZED_CODE = 1;
/** `connecting` code of the client's own `connect()`. */
const CONNECT_CALLED_CODE = 0;
/** Centrifugo disconnect codes of a refused connection: invalid token, permission denied. */
const REFUSAL_DISCONNECT_CODES = new Set([3500, 3507]);

/**
 * A refused handshake (AC-60): an error reply to the connect command (1xx, e.g. 101 unauthorized, 103 permission
 * denied; the temporary ones never reach `disconnected`) or a refusal disconnect code.
 */
export function isHandshakeRefusal(code: number): boolean {
  return (code >= 100 && code < 200) || REFUSAL_DISCONNECT_CODES.has(code);
}
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
  on(event: 'error', listener: (ctx: { type: string }) => void): unknown;
  newSubscription(channel: string, options?: CentrifugeSubscriptionOptions): CentrifugeSubscriptionLike;
  removeSubscription(sub: CentrifugeSubscriptionLike | null): void;
  setToken(token: string): void;
  connect(): void;
  disconnect(): void;
}

/** Subscription options the transport passes: a token source for a tokened channel (SPEC-12 W44). */
export interface CentrifugeSubscriptionOptions {
  getToken?: () => Promise<string>;
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
  /** `Retry-After` of a 429 is read from here (S8-07); a `fetch` `Response` fits. */
  headers?: { get(name: string): string | null };
}

/** `Retry-After` in delta-seconds → ms, capped at 60 s; anything else (absent, 0, a date, garbage) → `null`. */
export function retryAfterMs(value: string | null | undefined): number | null {
  if (!value || !/^\s*\d+\s*$/.test(value)) return null;
  const seconds = Number(value);
  return seconds > 0 ? Math.min(TOKEN_RETRY_AFTER_MAX_MS, seconds * 1000) : null;
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
  getToken?: () => Promise<string>;
}

interface ChannelEntry {
  records: Set<ListenerRecord>;
  filter: ChannelFilter;
  sub: CentrifugeSubscriptionLike | null;
  /** The current `sub` was created with a token source. */
  tokened: boolean;
  /** Centrifugo refused the token (`unsubscribed` code 1): tokenless until a new tokened listener arrives. */
  tokenRefused: boolean;
}

interface RetryHint {
  retryAfter: number | null;
}
const RETRY: RetryHint = Object.freeze({ retryAfter: null });
const REFUSED = Symbol('refused');
/** `error` event types of a failed connection attempt that the client would retry on its own schedule. */
const ATTEMPT_ERRORS = new Set(['transport', 'connect']);

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

/**
 * Subject of a connection token: `null` for `''` (anonymous); the JWT `sub` claim otherwise, `undefined` when it
 * cannot be read (then it counts as different). Only the claim is kept, never the token.
 */
function subjectOf(token: string): string | null | undefined {
  if (token === '') return null;
  try {
    const part = token.split('.')[1];
    if (!part) return undefined;
    const json = globalThis.atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims: unknown = JSON.parse(json);
    return isRecord(claims) && typeof claims.sub === 'string' && claims.sub ? claims.sub : undefined;
  } catch {
    return undefined;
  }
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
  /**
   * Subject of the token the client last got (`null` anonymous, `undefined` unknown); only the claim, never the token.
   * `renewToken` compares against it (SPEC-10 AC-31).
   */
  let subject: string | null | undefined;
  /** The running `renewToken`, so a renewal during a renewal makes no second request. */
  let renewal: Promise<void> | null = null;
  /** Number of the next reconnect attempt (AC-59); back to 0 once connected. */
  let attempt = 0;
  /** Own reconnect scheduled by the transport (drop, failed attempt or refusal). */
  let retry: { handle: unknown } | null = null;
  /** Set while the transport itself stops the client: that `disconnected` is not a refusal. */
  let quiet = false;

  function setState(next: ConnectionState): void {
    if (next === state) return;
    state = next;
    notifyAll(stateListeners, (listener) => listener(next));
  }

  /**
   * Pause before token retry `n` (0-based, per `getToken` loop): the first one random 5–10 s (AC-50), later ones grow
   * with full jitter up to 45 s (S8-07). A 429 `Retry-After` is honoured: never sooner than it says (capped at 60 s).
   */
  function tokenRetryDelay(n: number, retryAfter: number | null): number {
    let ms: number;
    if (n <= 0) {
      const spread = TOKEN_RETRY_MAX_MS - TOKEN_RETRY_MIN_MS;
      ms = TOKEN_RETRY_MIN_MS + Math.min(spread, Math.floor(random() * (spread + 1)));
    } else {
      ms = Math.max(TOKEN_RETRY_MIN_MS, reconnectDelay(n + TOKEN_RETRY_GROWTH_OFFSET, random));
    }
    return retryAfter === null ? ms : Math.max(ms, retryAfter);
  }

  /** Pause of `ms`; resolves `false` when the transport was torn down meanwhile. */
  function pause(ms: number): Promise<boolean> {
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

  /** `RetryHint` = retry; `retryAfter` is the honoured `Retry-After` of a 429 in ms, if any. */
  async function requestToken(): Promise<string | RetryHint | typeof REFUSED> {
    let response: RealtimeTokenResponse;
    try {
      response = await fetchToken(tokenUrl, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      return RETRY;
    }
    // Network errors, 5xx and 429 are retried (AC-50); so is any other refusal or a body that is not C1,
    // because a rejected `getToken` would make the client stop or back off on its own schedule.
    // A refusal (4xx other than 429) waits 30–60 s instead (AC-60).
    if (!response.ok) {
      if (response.status === 429) return { retryAfter: retryAfterMs(response.headers?.get('retry-after')) };
      return response.status >= 400 && response.status < 500 ? REFUSED : RETRY;
    }
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
    for (let failures = 0; ; ) {
      const token = await requestToken();
      if (typeof token === 'string') {
        if (started === generation) {
          anonymous = token === '';
          subject = subjectOf(token);
        }
        return token;
      }
      const ms = token === REFUSED ? refusalDelay(random) : tokenRetryDelay(failures++, token.retryAfter);
      if (!(await pause(ms)) || started !== generation) {
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

  /** The first listener's token source that is still subscribed; none → the channel is tokenless. */
  function tokenSourceOf(entry: ChannelEntry): (() => Promise<string>) | undefined {
    if (entry.tokenRefused) return undefined;
    for (const record of entry.records) if (record.getToken) return record.getToken;
    return undefined;
  }

  /**
   * Centrifugo allows one subscription per channel per client (W44): switching between tokenless and tokened removes
   * the subscription and subscribes again. Listeners and the de-duplication filter stay on the entry, so the other
   * listeners keep receiving events.
   */
  function sync(channel: string, entry: ChannelEntry): void {
    if (!client || !entry.sub || channels.get(channel) !== entry) return;
    if (entry.tokened === (tokenSourceOf(entry) !== undefined)) return;
    client.removeSubscription(entry.sub);
    attach(channel, entry, client);
  }

  function attach(channel: string, entry: ChannelEntry, centrifuge: CentrifugeClientLike): void {
    const tokened = tokenSourceOf(entry) !== undefined;
    // The source is looked up on every call: the listener that gave it may have left while another stays.
    const getToken = () => {
      const source = tokenSourceOf(entry);
      return source ? source() : Promise.resolve('');
    };
    const sub = tokened ? centrifuge.newSubscription(channel, { getToken }) : centrifuge.newSubscription(channel);
    entry.sub = sub;
    entry.tokened = tokened;
    const isCurrent = () => channels.get(channel) === entry && entry.sub === sub;
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
      if (!isCurrent()) return;
      if (tokened && ctx.code === SUBSCRIPTION_UNAUTHORIZED_CODE) {
        // The token source gave nothing usable: the channel goes on without a token for every listener.
        entry.tokenRefused = true;
        centrifuge.removeSubscription(sub);
        attach(channel, entry, centrifuge);
        return;
      }
      if (ctx.code !== PERMISSION_DENIED_CODE) return;
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

  function cancelRetry(): void {
    if (!retry) return;
    timers.clearTimeout(retry.handle);
    retry = null;
  }

  /** `connect()` of the client after `ms`, unless the transport was torn down or connected meanwhile. */
  function scheduleConnect(ms: number): void {
    cancelRetry();
    const started = generation;
    const pending: { handle: unknown } = { handle: undefined };
    pending.handle = timers.setTimeout(() => {
      if (retry !== pending) return;
      retry = null;
      if (started !== generation || channels.size === 0 || !client) return;
      setState('connecting');
      client.connect();
    }, ms);
    retry = pending;
  }

  /**
   * The connection dropped or an attempt failed (AC-59): stop the client's own retry and call `connect()` after
   * `reconnectDelay(attempt)`. Subscriptions stay on the client and resubscribe (with recovery) on `connect()`.
   */
  function dropped(centrifuge: CentrifugeClientLike): void {
    if (channels.size === 0 || retry) return;
    // A token loop of the abandoned attempt stops at its next pause.
    generation += 1;
    quiet = true;
    try {
      centrifuge.disconnect();
    } finally {
      quiet = false;
    }
    setState('connecting');
    scheduleConnect(reconnectDelay(attempt, random));
    attempt += 1;
  }

  function createClient(module: CentrifugeModuleLike): CentrifugeClientLike {
    const centrifuge = new module.Centrifuge(url, {
      getToken,
      minReconnectDelay: MIN_RECONNECT_DELAY_MS,
      maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
    });
    centrifuge.on('state', (ctx) => {
      if (channels.size === 0) return;
      if (ctx.newState === 'connected') {
        attempt = 0;
        cancelRetry();
      }
      if (ctx.newState === 'connecting' || ctx.newState === 'connected') setState(ctx.newState);
    });
    centrifuge.on('connecting', (ctx) => {
      // The server invalidated the state: the subject may have changed, so the next token is asked for again.
      if (ctx.code === STATE_INVALIDATED_CODE) anonymous = false;
      // Any code but our own `connect()` is a drop the client would retry on its own schedule.
      if (ctx.code !== CONNECT_CALLED_CODE) dropped(centrifuge);
    });
    centrifuge.on('error', (ctx) => {
      if (state === 'connecting' && ATTEMPT_ERRORS.has(ctx.type)) dropped(centrifuge);
    });
    centrifuge.on('disconnected', (ctx) => {
      if (quiet) return;
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
      // The server refused the handshake (AC-60): retry in 30–60 s. Any other final code stays final, as in SPEC-06.
      if (channels.size > 0 && isHandshakeRefusal(ctx.code)) scheduleConnect(refusalDelay(random));
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
        if ((await pause(tokenRetryDelay(0, null))) && !client && channels.size > 0) load();
      });
  }

  function start(): void {
    // A refusal pause is pending (AC-60): its timer connects.
    if (state !== 'disconnected' || retry) return;
    setState('connecting');
    if (client) client.connect();
    else load();
  }

  function teardown(): void {
    generation += 1;
    anonymous = false;
    subject = undefined;
    attempt = 0;
    cancelRetry();
    for (const pending of [...pauses]) {
      timers.clearTimeout(pending.handle);
      pending.wake(false);
    }
    setState('disconnected');
    client?.disconnect();
  }

  /**
   * Reconnect with `token` (SPEC-10 AC-31): stop the client quietly, hand it the token, connect again. Subscriptions
   * stay on the client and resubscribe on `connect()`. `''` drops the token, so the client asks `getToken` itself
   * (with the AC-50 retries) — used when the one renewal request failed.
   */
  function reconnectWith(centrifuge: CentrifugeClientLike, token: string): void {
    // A token loop of the abandoned attempt stops at its next pause.
    generation += 1;
    cancelRetry();
    attempt = 0;
    quiet = true;
    try {
      centrifuge.disconnect();
    } finally {
      quiet = false;
    }
    centrifuge.setToken(token);
    setState('connecting');
    centrifuge.connect();
  }

  async function renew(): Promise<void> {
    // Whatever happens, the next token request is no longer the memoised anonymous answer.
    anonymous = false;
    const centrifuge = client;
    if (!url || !centrifuge || channels.size === 0) return;
    const started = generation;
    const token = await requestToken();
    if (client !== centrifuge || channels.size === 0 || started !== generation) return;
    if (typeof token !== 'string') {
      subject = undefined;
      reconnectWith(centrifuge, '');
      return;
    }
    const next = subjectOf(token);
    if (next !== undefined && next === subject) {
      // Same owner (or still anonymous): the open connection stays as it is.
      anonymous = token === '';
      return;
    }
    reconnectWith(centrifuge, token);
    anonymous = token === '';
    subject = next;
  }

  return {
    renewToken(): Promise<void> {
      renewal ??= renew().finally(() => {
        renewal = null;
      });
      return renewal;
    },
    subscribe(channel, listener, options): Unsubscribe {
      if (!url) return () => {};
      const record: ListenerRecord = { listener };
      if (options?.getToken) record.getToken = options.getToken;
      let entry = channels.get(channel);
      if (!entry) {
        entry = { records: new Set([record]), filter: createChannelFilter(), sub: null, tokened: false, tokenRefused: false };
        channels.set(channel, entry);
        if (client) attach(channel, entry, client);
      } else {
        // A new token source tries again after a refused one.
        if (record.getToken) entry.tokenRefused = false;
        entry.records.add(record);
        sync(channel, entry);
      }
      const owner = entry;
      start();

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        owner.records.delete(record);
        if (owner.records.size > 0) {
          sync(channel, owner);
          return;
        }
        if (channels.get(channel) !== owner) return;
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
