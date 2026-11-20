/**
 * Адаптер `http` домену `site` (SPEC-08, AC-45 … AC-51, AC-58).
 * - `state()` — `GET /api/site/state` (публічна, кеш краю 10 с); тіло перевіряє `parseSiteState`, старіший знімок не
 *   перемагає новіший (`applySiteEvent`, AC-46/47).
 * - `subscribe()` — канал `site:state` (лише події `snapshot`, що проходять схему; `clock` і решту ігнорує, AC-45) і
 *   перечитування: кожні 15 с, поки realtime не `connected` чи його немає (AC-48), інакше кожні 30 с (AC-49);
 *   `onResync` — одразу (AC-50). Невдале перечитування лишає останній знімок (AC-51).
 * - Передстартова збірка (`NEXT_PUBLIC_PRELAUNCH=1`) — знімок збірки без мережі й таймерів.
 * Транспорт realtime вантажиться динамічно й лише коли `NEXT_PUBLIC_REALTIME_URL` задано під час збирання (AC-58).
 */
import { parseSiteState, SITE_CHANNEL_CLASS, type RealtimeEnvelope } from '@time2fest/contracts';
import { applySiteEvent, type SiteEvent, type SiteService, type SiteState } from '../contracts/site';
import { fail, ok, type ApiResult } from '../result';
import { buildSnapshot } from '../site/buildSnapshot';
import type { ConnectionState, RealtimeTransport } from './realtime/types';

export const SITE_STATE_URL = '/api/site/state';
/** Перечитування, поки realtime не `connected` (AC-48). */
export const SITE_POLL_OFFLINE_MS = 15_000;
/** Перечитування за `connected` (AC-49). */
export const SITE_POLL_ONLINE_MS = 30_000;

export interface SiteFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SiteFetch = (input: string, init: { credentials: 'omit' }) => Promise<SiteFetchResponse>;

export interface SiteTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HttpSiteOptions {
  fetch?: SiteFetch;
  /** `null` — realtime у збірці немає (лише перечитування). */
  loadTransport?: (() => Promise<RealtimeTransport>) | null;
  timers?: SiteTimers;
  /** Передстартова збірка: знімок збірки, без мережі. */
  prelaunch?: boolean;
}

/** Літерал збирання: без `NEXT_PUBLIC_REALTIME_URL` гілка з `import()` мертва, і `centrifuge` у пакет не потрапляє (AC-58). */
function defaultLoadTransport(): (() => Promise<RealtimeTransport>) | null {
  return process.env.NEXT_PUBLIC_REALTIME_URL
    ? () => import('./realtime').then((m) => m.getRealtimeTransport())
    : null;
}

const defaultTimers: SiteTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Той самий знімок (повтор опитування чи події) — слухачам не шлемо. */
function sameSnapshot(a: SiteState | undefined, b: SiteState): boolean {
  return !!a && a.version === b.version && a.at === b.at && a.outage === b.outage;
}

function prelaunchSite(): SiteService {
  const snapshot = buildSnapshot();
  return {
    state: async () => ok(snapshot),
    subscribe: () => () => {},
    peek: () => snapshot,
  };
}

export function createHttpSite(options: HttpSiteOptions = {}): SiteService {
  if (options.prelaunch ?? process.env.NEXT_PUBLIC_PRELAUNCH === '1') return prelaunchSite();
  const fetchState: SiteFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const loadTransport = options.loadTransport === undefined ? defaultLoadTransport() : options.loadTransport;
  const timers = options.timers ?? defaultTimers;

  let last: SiteState | undefined;
  const listeners = new Set<(event: SiteEvent) => void>();
  /** Живе підключення (є слухачі): транспорт, таймер, відписки. */
  let live: { stop(): void } | null = null;

  /** Застосувати знімок за правилом `applySiteEvent`; слухачам — лише коли щось змінилося. */
  function apply(state: SiteState): SiteState {
    const next = applySiteEvent(last, { type: 'snapshot', state });
    if (next === last || sameSnapshot(last, next)) return last ?? next;
    last = next;
    const event: SiteEvent = { type: 'snapshot', state: next };
    for (const l of [...listeners]) l(event);
    return next;
  }

  async function read(): Promise<ApiResult<SiteState>> {
    let res: SiteFetchResponse;
    try {
      res = await fetchState(SITE_STATE_URL, { credentials: 'omit' });
    } catch {
      return fail('network');
    }
    if (!res.ok) return fail('unavailable', { message: `GET ${SITE_STATE_URL} → ${res.status}` });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const state = parseSiteState(body);
    return state ? ok(state) : fail('unavailable', { message: 'invalid site state' });
  }

  function start(): { stop(): void } {
    let stopped = false;
    let transport: RealtimeTransport | null = null;
    let timer: unknown;
    let timerSet = false;
    const offs: Array<() => void> = [];

    const connected = () => transport?.state() === 'connected';

    const schedule = () => {
      if (timerSet) timers.clearTimeout(timer);
      timerSet = true;
      timer = timers.setTimeout(poll, connected() ? SITE_POLL_ONLINE_MS : SITE_POLL_OFFLINE_MS);
    };

    function poll(): void {
      if (stopped) return;
      timerSet = false;
      schedule();
      void read().then((r) => {
        if (!stopped && r.ok) apply(r.value);
      });
    }

    schedule();

    if (loadTransport) {
      loadTransport()
        .then((t) => {
          if (stopped) return;
          transport = t;
          offs.push(
            t.subscribe(SITE_CHANNEL_CLASS, {
              onEvent: (envelope: RealtimeEnvelope) => {
                if (envelope.type !== 'snapshot') return;
                const state = parseSiteState(envelope.data);
                if (state) apply(state);
              },
              onResync: poll,
            }),
          );
          // Перехід у `connected` і з нього міняє крок перечитування; поки не `connected` — 15 с від цієї миті.
          offs.push(
            t.onStateChange((s: ConnectionState) => {
              if (!stopped && s !== 'connected') schedule();
            }),
          );
          schedule();
        })
        .catch(() => {
          /* realtime недоступний: лишається перечитування кожні 15 с */
        });
    }

    return {
      stop() {
        stopped = true;
        if (timerSet) timers.clearTimeout(timer);
        timerSet = false;
        for (const off of offs.splice(0)) off();
      },
    };
  }

  return {
    async state() {
      const r = await read();
      return r.ok ? ok(apply(r.value)) : r;
    },
    subscribe(cb) {
      listeners.add(cb);
      live ??= start();
      return () => {
        if (!listeners.delete(cb) || listeners.size > 0) return;
        live?.stop();
        live = null;
      };
    },
    peek: () => last,
  };
}
