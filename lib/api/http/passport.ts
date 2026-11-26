/**
 * Адаптер `http` домену `passport` (SPEC-14, AC-48, AC-59). Рецепт — `docs/backend/frontend-seam.md` §6.0 (як `profile.ts`).
 * - `stamps` — `GET /api/me/stamps`; `claim` — `POST /api/me/stamps` (помилки через `errorOf` зберігають `reason` і
 *   `retryAfterMs`); `beat` — `POST /api/presence` → `{nextBeatMs}`. Тіла відповідей перевіряють безzod-охоронці
 *   `@time2fest/contracts` (`passportGuard`). Токенів не зберігаємо: лише cookie.
 * - `subscribe` — події `stamp` (і `session`, бо змінює власника) каналу `user:#<суб’єкт>`; суб’єкта дає
 *   `GET /api/auth/get-session`; відновлення з’єднання — перечитування списку (`snapshot`).
 * - `trackPresence` — локальна присутність як у `sim` (`lib/presence/trackSurface`) плюс цикл пульсів: перший — одразу,
 *   далі через `nextBeatMs` за ГОДИННИКОМ САЙТУ (`PresenceClock`, не `Date.now` і без таймерів — машина часу), `null` —
 *   зупинка. Нова поверхня — новий виклик, отже новий цикл.
 * - `mergeGuest` немає: сервер зливає штампи сам при вході (AC-48).
 */
import { isBeatResponse, isStamp, isStampEvent, isStampList, parseSession } from '@time2fest/contracts';
import type { PassportEvent, PassportService, PresenceBeat, PresenceClock, PresenceSurfaceInput } from '../contracts/passport';
import { fail, ok, type ApiResult } from '../result';
import type { Ms, Stamp } from '@/lib/data/types';
import { trackSurfaceLocally } from '@/lib/presence/trackSurface';
import { AUTH_URLS, errorOf } from './auth';
import type { ProfileFetch, ProfileFetchResponse } from './profile';
import type { RealtimeTransport } from './realtime/types';

export const PASSPORT_URLS = {
  stamps: '/api/me/stamps',
  beat: '/api/presence',
} as const;

/** Пауза перед повтором пульсу, коли сервер не назвав своєї (мс). */
export const BEAT_RETRY_MS = 5_000;
/** Скільки подій сервер приймає в одному пульсі. */
const MAX_BEAT_EVENTS = 8;

type Method = 'GET' | 'POST';

export interface HttpPassportOptions {
  fetch?: ProfileFetch;
  /** Транспорт чи його завантажувач; `null` — realtime немає (підписка мовчить). */
  transport?: RealtimeTransport | (() => Promise<RealtimeTransport>) | null;
}

export function createHttpPassport(options: HttpPassportOptions = {}): PassportService {
  const doFetch: ProfileFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const transportOpt = options.transport ?? null;

  let last: readonly Stamp[] | undefined;
  const listeners = new Set<(e: PassportEvent) => void>();
  let live: { stop(): void } | null = null;
  let transportPromise: Promise<RealtimeTransport | null> | undefined;

  function getTransport(): Promise<RealtimeTransport | null> {
    transportPromise ??= (async () => {
      if (!transportOpt) return null;
      return typeof transportOpt === 'function' ? transportOpt() : transportOpt;
    })().catch(() => null);
    return transportPromise;
  }

  async function call<T>(url: string, method: Method, body: unknown, parse: (value: unknown) => T | null): Promise<ApiResult<T>> {
    let res: ProfileFetchResponse;
    try {
      res = await doFetch(url, {
        method,
        credentials: 'include',
        ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
      });
    } catch {
      return fail('network');
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const env = json as { ok?: unknown; value?: unknown } | null | undefined;
    if (!res.ok || !env || typeof env !== 'object' || env.ok !== true) return { ok: false, error: errorOf(json, res.status) };
    const value = parse(env.value);
    return value === null ? fail('unavailable', { message: `invalid ${url} response` }) : ok(value);
  }

  const parseStamp = (v: unknown): Stamp | null => (isStamp(v) ? (v as Stamp) : null);
  const parseStamps = (v: unknown): readonly Stamp[] | null => (isStampList(v) ? (v as Stamp[]) : null);
  const parseBeat = (v: unknown): { nextBeatMs: number | null } | null => (isBeatResponse(v) ? v : null);

  const emit = (e: PassportEvent) => {
    for (const l of [...listeners]) l(e);
  };

  async function readStamps(): Promise<ApiResult<readonly Stamp[]>> {
    const r = await call(PASSPORT_URLS.stamps, 'GET', undefined, parseStamps);
    if (r.ok) last = r.value;
    return r;
  }

  async function subjectId(): Promise<string | null> {
    const r = await call(AUTH_URLS.session, 'GET', undefined, parseSession as (v: unknown) => { user?: { id: string } | null; guestId: string } | null);
    if (!r.ok || !r.value) return null;
    return r.value.user?.id ?? r.value.guestId;
  }

  function start(): { stop(): void } {
    let stopped = false;
    let channel = '';
    let off: (() => void) | undefined;
    let transport: RealtimeTransport | null = null;

    const resnapshot = async () => {
      const r = await readStamps();
      if (r.ok && !stopped) emit({ type: 'snapshot', stamps: r.value });
    };

    const attach = async () => {
      if (stopped || !transport) return;
      const id = await subjectId();
      if (stopped || !id) return;
      const next = `user:#${id}`;
      if (next === channel) return;
      off?.();
      channel = next;
      off = transport.subscribe(next, {
        onEvent: (envelope) => {
          if (isStampEvent(envelope)) {
            const d = envelope.data;
            if (d.kind === 'granted') {
              const stamp = d.stamp as Stamp;
              if (last && !last.some((s) => s.eventId === stamp.eventId)) last = [...last, stamp];
              emit({ type: 'granted', stamp });
            } else {
              last = d.stamps as Stamp[];
              emit({ type: 'snapshot', stamps: last });
            }
          } else if ((envelope as { type?: unknown } | null)?.type === 'session') {
            // Змінився власник сесії: перепідписатися на його канал і перечитати штампи.
            void attach();
            void resnapshot();
          }
        },
        onResync: () => void resnapshot(),
      });
    };

    void (async () => {
      transport = await getTransport();
      if (stopped || !transport) return;
      await attach();
    })();

    return {
      stop() {
        stopped = true;
        off?.();
        off = undefined;
      },
    };
  }

  const beat = (b: PresenceBeat): Promise<ApiResult<{ nextBeatMs: number | null }>> =>
    call(PASSPORT_URLS.beat, 'POST', { eventIds: b.eventIds.slice(0, MAX_BEAT_EVENTS), source: b.source, openedAt: b.openedAt }, parseBeat);

  /** Пульси поверхні: перший — одразу, далі за `nextBeatMs` годинника сайту; `null` — зупинка. */
  function startBeats(surface: PresenceSurfaceInput, clock: PresenceClock): () => void {
    const nowOf = (): Ms => clock.now() || clock.fallbackNow();
    let stopped = false;
    let inFlight = false;
    /** Коли слати наступний пульс (час сайту); `null` — не плануємо. */
    let dueAt: Ms | null = null;

    const send = () => {
      if (stopped || inFlight) return;
      inFlight = true;
      dueAt = null;
      const ids = surface.eventIds.slice(0, MAX_BEAT_EVENTS);
      const opened = ids.map((id) => surface.openedAt.get(id)).filter((v): v is Ms => typeof v === 'number');
      const openedAt = opened.length ? Math.min(...opened) : nowOf();
      void beat({ eventIds: ids, source: surface.source, openedAt }).then(
        (r) => {
          inFlight = false;
          if (stopped) return;
          if (r.ok) {
            dueAt = r.value.nextBeatMs === null ? null : nowOf() + r.value.nextBeatMs;
            return;
          }
          const c = r.error.code;
          const retryable = c === 'network' || c === 'unavailable' || c === 'rate_limited' || c === 'unknown';
          dueAt = retryable ? nowOf() + Math.max(r.error.retryAfterMs ?? 0, BEAT_RETRY_MS) : null;
        },
        () => {
          inFlight = false;
          if (!stopped) dueAt = nowOf() + BEAT_RETRY_MS;
        },
      );
    };

    const tick = () => {
      if (stopped || inFlight || dueAt === null) return;
      if (nowOf() >= dueAt) send();
    };
    send();
    const off = clock.subscribe(tick);
    return () => {
      stopped = true;
      off();
    };
  }

  return {
    stamps: readStamps,
    peek: () => last,
    subscribe(cb) {
      listeners.add(cb);
      live ??= start();
      return () => {
        if (!listeners.delete(cb) || listeners.size > 0) return;
        live?.stop();
        live = null;
      };
    },
    trackPresence(surface, clock) {
      const stopLocal = trackSurfaceLocally(surface, clock);
      if (!surface || !surface.eventIds.length) return stopLocal;
      const stopBeats = startBeats(surface, clock);
      return () => {
        stopBeats();
        stopLocal();
      };
    },
    beat,
    async claim(req) {
      const r = await call(PASSPORT_URLS.stamps, 'POST', { eventId: req.eventId, source: req.source, at: req.at }, parseStamp);
      if (r.ok && last && !last.some((s) => s.eventId === r.value.eventId)) last = [...last, r.value];
      return r;
    },
  };
}
