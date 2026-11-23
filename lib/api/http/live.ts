/**
 * Адаптер `http` домену «Ефір» (SPEC-12, AC-16 … AC-20, AC-23), за зразком `lib/api/http/site.ts`.
 * - `chains()` — `GET /api/live/chains` (публічна, без параметрів), тіло перевіряє `parseChainsResponse`.
 * - `subscribeStreams()` — канал `live:streams`: події, що проходять `parseStreamEvent`, доходять; невідомі й биті — ні
 *   (AC-16). І перечитування: кожні 15 с, поки realtime не `connected` чи його немає, інакше кожні 30 с; `onResync` —
 *   одразу (AC-19). Різницю перечитаного з останнім застосованим адаптер віддає подіями `chain` з версією відповіді;
 *   старіша відповідь не дає нічого (AC-17). Невдале перечитування лишає останнє застосоване (AC-20).
 * - `viewers()` / `subscribeViewers()` — `GET /api/live/viewers` і агрегат каналу `live:viewers`; підписка лічена
 *   (`./viewerPresence`: одна вкладка браузера з токеном підписки, решта без нього; AC-59, AC-61).
 * - `reportSourceError()` — `POST /api/live/source-errors`.
 * - Передстартова збірка (`NEXT_PUBLIC_PRELAUNCH=1`) — ланцюжки збірки (впорскує `http/index.ts`), порожні глядачі, без
 *   мережі й таймерів.
 * Транспорт realtime вантажиться динамічно й лише коли `NEXT_PUBLIC_REALTIME_URL` задано під час збирання (AC-23).
 */
import {
  applyStreamEvent,
  LIVE_STREAMS_CLASS,
  LIVE_VIEWERS_CLASS,
  parseChainsResponse,
  parseStreamEvent,
  parseViewerSummary,
  type RealtimeEnvelope,
} from '@time2fest/contracts';
import type { ChainsResponse, LiveService, StreamEvent, ViewerSummary } from '../contracts/live';
import { fail, ok, type ApiResult } from '../result';
import type { ConnectionState, RealtimeTransport } from './realtime/types';
import { subscribeCountedViewers, type CountedViewersOptions } from './viewerPresence';
import type { StreamChain } from '@/lib/data/types';

export const LIVE_CHAINS_URL = '/api/live/chains';
export const LIVE_VIEWERS_URL = '/api/live/viewers';
export const LIVE_SOURCE_ERRORS_URL = '/api/live/source-errors';
/** Перечитування, поки realtime не `connected` (AC-19). */
export const LIVE_POLL_OFFLINE_MS = 15_000;
/** Перечитування за `connected`: не рідше ніж раз на 30 с (AC-19). */
export const LIVE_POLL_ONLINE_MS = 30_000;

export interface LiveFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface LiveFetchInit {
  method?: 'GET' | 'POST';
  credentials: 'omit';
  headers?: Record<string, string>;
  body?: string;
}

export type LiveFetch = (input: string, init: LiveFetchInit) => Promise<LiveFetchResponse>;

export interface LiveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HttpLiveOptions {
  fetch?: LiveFetch;
  /** `null` — realtime у збірці немає (лише перечитування). */
  loadTransport?: (() => Promise<RealtimeTransport>) | null;
  timers?: LiveTimers;
  /** Передстартова збірка: ланцюжки збірки, без мережі. */
  prelaunch?: boolean;
  /** Ланцюжки збірки (`data/streams*.json`); обов'язкові для передстартової збірки. */
  buildChains?: () => readonly StreamChain[];
  /** Замки, запит токена глядача й події сторінки для лічених глядачів (тести; типово — браузерні). */
  viewerPresence?: Pick<CountedViewersOptions, 'locks' | 'fetch' | 'page'>;
}

/** Літерал збирання: без `NEXT_PUBLIC_REALTIME_URL` гілка з `import()` мертва, і `centrifuge` у пакет не потрапляє (AC-23). */
function defaultLoadTransport(): (() => Promise<RealtimeTransport>) | null {
  return process.env.NEXT_PUBLIC_REALTIME_URL
    ? () => import('./realtime').then((m) => m.getRealtimeTransport())
    : null;
}

const defaultTimers: LiveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const sameChain = (a: StreamChain, b: StreamChain) => JSON.stringify(a) === JSON.stringify(b);

function prelaunchLive(buildChains: (() => readonly StreamChain[]) | undefined): LiveService {
  if (!buildChains) throw new Error('createHttpLive: prelaunch build needs a buildChains provider');
  const chains = [...buildChains()];
  return {
    chains: async () => ok({ version: 0, at: new Date().toISOString(), chains }),
    subscribeStreams: () => () => {},
    viewers: async () => ok({ countries: [], at: new Date().toISOString() }),
    subscribeViewers: () => () => {},
    reportSourceError: async () => ok(undefined),
  };
}

/** Останнє застосоване адаптером: з чого рахується різниця перечитування. */
interface Applied {
  chains: ReadonlyMap<string, StreamChain>;
  version: number;
}

export function createHttpLive(options: HttpLiveOptions = {}): LiveService {
  if (options.prelaunch ?? process.env.NEXT_PUBLIC_PRELAUNCH === '1') return prelaunchLive(options.buildChains);
  const doFetch: LiveFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const loadTransport = options.loadTransport === undefined ? defaultLoadTransport() : options.loadTransport;
  const timers = options.timers ?? defaultTimers;

  let applied: Applied | undefined;
  const streamListeners = new Set<(event: StreamEvent) => void>();
  const viewerListeners = new Set<(summary: ViewerSummary) => void>();
  let streams: { stop(): void } | null = null;
  let viewersLive: { stop(): void } | null = null;

  async function getJson(url: string): Promise<ApiResult<unknown>> {
    let res: LiveFetchResponse;
    try {
      res = await doFetch(url, { credentials: 'omit' });
    } catch {
      return fail('network');
    }
    if (!res.ok) return fail('unavailable', { message: `GET ${url} → ${res.status}` });
    try {
      return ok(await res.json());
    } catch {
      return ok(undefined);
    }
  }

  async function read(): Promise<ApiResult<ChainsResponse>> {
    const r = await getJson(LIVE_CHAINS_URL);
    if (!r.ok) return r;
    const body = parseChainsResponse(r.value);
    return body ? ok(body as unknown as ChainsResponse) : fail('unavailable', { message: 'invalid live chains' });
  }

  /**
   * Прийняти відповідь: старіша за застосоване — нічого (AC-17). Інакше — події `chain` для кожного зміненого, нового й
   * зниклого ланцюжка; незмінені ланцюжки лишаються тими самими об’єктами.
   */
  function absorb(res: ChainsResponse): { response: ChainsResponse; events: StreamEvent[] } {
    if (applied && res.version < applied.version) return { response: res, events: [] };
    const prev = applied?.chains;
    const events: StreamEvent[] = [];
    const next = new Map<string, StreamChain>();
    const chains = res.chains.map((c) => {
      const old = prev?.get(c.eventId);
      const kept = old && sameChain(old, c) ? old : c;
      if (kept !== old) events.push({ type: 'chain', chain: kept, version: res.version });
      next.set(c.eventId, kept);
      return kept;
    });
    for (const [eventId] of prev ?? []) {
      if (!next.has(eventId)) events.push({ type: 'chain', chain: { eventId, sources: [] }, version: res.version });
    }
    applied = { chains: next, version: res.version };
    return { response: { ...res, chains }, events };
  }

  function emit(event: StreamEvent): void {
    for (const l of [...streamListeners]) l(event);
  }

  /** Подія каналу: перевірена схемою — у застосоване й слухачам; невідома чи бита — ігнорується (AC-16). */
  function onStreamEnvelope(envelope: RealtimeEnvelope): void {
    const event = parseStreamEvent(envelope.data) as unknown as StreamEvent | null;
    if (!event) return;
    if (applied) {
      const r = applyStreamEvent(applied.chains, event, applied.version);
      applied = { chains: r.chains, version: r.version };
    }
    emit(event);
  }

  /** Транспорт (якщо є) з відпискою; `stop` до завантаження — підписки не буде. */
  function withTransport(attach: (t: RealtimeTransport) => Array<() => void>): () => void {
    let stopped = false;
    const offs: Array<() => void> = [];
    if (loadTransport) {
      loadTransport()
        .then((t) => {
          if (!stopped) offs.push(...attach(t));
        })
        .catch(() => {
          /* realtime недоступний: лишається перечитування */
        });
    }
    return () => {
      stopped = true;
      for (const off of offs.splice(0)) off();
    };
  }

  function startStreams(): { stop(): void } {
    let stopped = false;
    let transport: RealtimeTransport | null = null;
    let timer: unknown;
    let timerSet = false;

    const connected = () => transport?.state() === 'connected';

    const schedule = () => {
      if (timerSet) timers.clearTimeout(timer);
      timerSet = true;
      timer = timers.setTimeout(poll, connected() ? LIVE_POLL_ONLINE_MS : LIVE_POLL_OFFLINE_MS);
    };

    function poll(): void {
      if (stopped) return;
      timerSet = false;
      schedule();
      void read().then((r) => {
        if (stopped || !r.ok) return;
        for (const event of absorb(r.value).events) emit(event);
      });
    }

    schedule();
    const detach = withTransport((t) => {
      transport = t;
      const offs = [
        t.subscribe(LIVE_STREAMS_CLASS, { onEvent: onStreamEnvelope, onResync: poll }),
        // Перехід у `connected` і з нього міняє крок перечитування; поки не `connected` — 15 с від цієї миті.
        t.onStateChange((s: ConnectionState) => {
          if (!stopped && s !== 'connected') schedule();
        }),
      ];
      schedule();
      return offs;
    });

    return {
      stop() {
        stopped = true;
        if (timerSet) timers.clearTimeout(timer);
        timerSet = false;
        detach();
      },
    };
  }

  function startViewers(): { stop(): void } {
    const detach = withTransport((t) => [
      subscribeCountedViewers({
        ...options.viewerPresence,
        transport: t,
        channel: LIVE_VIEWERS_CLASS,
        listener: {
          onEvent: (envelope: RealtimeEnvelope) => {
            const summary = parseViewerSummary(envelope.data) as unknown as ViewerSummary | null;
            if (summary) for (const l of [...viewerListeners]) l(summary);
          },
        },
      }),
    ]);
    return { stop: detach };
  }

  return {
    async chains() {
      const r = await read();
      return r.ok ? ok(absorb(r.value).response) : r;
    },
    subscribeStreams(cb) {
      streamListeners.add(cb);
      streams ??= startStreams();
      return () => {
        if (!streamListeners.delete(cb) || streamListeners.size > 0) return;
        streams?.stop();
        streams = null;
      };
    },
    async viewers() {
      const r = await getJson(LIVE_VIEWERS_URL);
      if (!r.ok) return r;
      // The route answers through the server pipeline as `{ok: true, value: summary}`; the bare summary is accepted too.
      const body = r.value as { ok?: unknown; value?: unknown } | null | undefined;
      const wire = body && typeof body === 'object' && body.ok === true && 'value' in body ? body.value : body;
      const summary = parseViewerSummary(wire) as unknown as ViewerSummary | null;
      return summary ? ok(summary) : fail('unavailable', { message: 'invalid viewer summary' });
    },
    subscribeViewers(cb) {
      viewerListeners.add(cb);
      viewersLive ??= startViewers();
      return () => {
        if (!viewerListeners.delete(cb) || viewerListeners.size > 0) return;
        viewersLive?.stop();
        viewersLive = null;
      };
    },
    async reportSourceError(report) {
      let res: LiveFetchResponse;
      try {
        res = await doFetch(LIVE_SOURCE_ERRORS_URL, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: report.eventId, sourceId: report.sourceId, code: report.code }),
        });
      } catch {
        return fail('network');
      }
      if (res.ok) return ok(undefined);
      if (res.status === 429) return fail('rate_limited');
      if (res.status === 400) return fail('validation', { reason: 'invalid' });
      return fail('unavailable', { message: `POST ${LIVE_SOURCE_ERRORS_URL} → ${res.status}` });
    },
  };
}
