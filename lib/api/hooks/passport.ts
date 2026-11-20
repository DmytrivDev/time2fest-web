'use client';

/**
 * Хуки домену «Паспорт» (`docs/backend/frontend-seam.md`, E5b) — єдине, що бачать компоненти.
 * - `usePresence(surface)` — сторінка показує події (колишній `useStampGrant`): присутність іде в сервіс, штамп видає сервіс.
 * - `useStamps()` — свої штампи (ресурс з `peek`: перший кадр після гідратації вже з паспортом, без «порожньо на мить»).
 * - `useStampGranted(cb)` — щойно видані штампи (свято в шапці).
 * - Штамп, якого сервер ще не підтвердив (стан №14, 2026-11-14): на `moment:stamp` штамп показуємо одразу (він є в
 *   `useStamps()`), а підтвердження (`passport.claim`) повторюємо у фоні (`lib/passport/stampClaims`). `useUnconfirmedStamps()` —
 *   події, що чекають довше хвилини (тихий рядок біля штампа й у паспорті).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { applyPassportEvent, type PassportEvent } from '../contracts/passport';
import { createResource, useResource } from '../resource';
import { getService } from '../services';
import type { Ms, PresenceSource, Stamp } from '@/lib/data/types';
import { patchedData } from '@/lib/api/hooks/site';
import { buildStamp } from '@/lib/engine/stamp';
import { on } from '@/lib/events/bus';
import type { MomentStamp } from '@/lib/events/types';
import { createStampClaimer, type ClaimsSnapshot, type PendingClaim } from '@/lib/passport/stampClaims';
import { safeGet, safeRemove, safeSet } from '@/lib/storage/safe';
import { useClock } from '@/lib/time/TimeProvider';

const EMPTY: readonly Stamp[] = [];

export const passportStamps = createResource<readonly Stamp[], PassportEvent>(() => {
  const svc = getService('passport');
  return { load: () => svc.stamps(), subscribe: (cb) => svc.subscribe(cb), reduce: applyPassportEvent, peek: () => svc.peek?.() };
});

// ── Штампи, що чекають підтвердження сервера ──────────────────────────────────────────────────────────────────────

/** Список на пристрої — переживає перезавантаження («наступне відкриття сайту» повторює запит). */
export const STAMP_CLAIMS_KEY = 't2f:stamp-claims:v1';

const claimer = createStampClaimer({
  claim: (stamp) => getService('passport').claim({ eventId: stamp.eventId, source: stamp.presenceSource, at: stamp.grantedAt }),
  now: () => Date.now(),
  load: () => {
    try {
      const raw = JSON.parse(safeGet('local', STAMP_CLAIMS_KEY) ?? '[]') as unknown;
      return Array.isArray(raw) ? (raw as PendingClaim[]) : [];
    } catch {
      return [];
    }
  },
  save: (list) => (list.length ? safeSet('local', STAMP_CLAIMS_KEY, JSON.stringify(list)) : safeRemove('local', STAMP_CLAIMS_KEY)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
});

/** Слухачі «штамп з’явився» (кожен сам відсіює той самий штамп удруге — з підтвердженням сервера). */
const localGranted = new Set<(stamp: Stamp) => void>();

let started = false;
/** Раз на вкладку: підхопити непідтверджені з минулого візиту, слухати мережу й підтвердження сервера. */
function startClaims(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  claimer.resume();
  window.addEventListener('online', () => claimer.retryNow());
  getService('passport').subscribe((e) => {
    if (e.type === 'granted') claimer.confirmed(e.stamp.eventId);
    else e.stamps.forEach((x) => claimer.confirmed(x.eventId));
  });
}

/** Опівночі +15 с: штамп за кожну подію, де гість був присутній, — одразу на пристрої, підтвердження — у фоні. */
function claimFromMoment(payload: MomentStamp): void {
  const data = patchedData();
  const have = new Set(currentStamps().map((x) => x.eventId));
  for (const id of payload.presentEventIds) {
    if (have.has(id)) continue;
    const event = data.eventsById.get(id);
    if (!event) continue;
    const stamp = buildStamp({
      event,
      country: data.countriesByIso.get(event.countryIso),
      city: data.citiesById.get(event.cityId),
      presenceSource: payload.presenceSources[id] ?? 'air',
    });
    if (!claimer.add(stamp)) continue;
    // Свято й оголошення — від появи штампа на пристрої (сервер може підтвердити пізніше; у `sim` — у тому ж такті).
    localGranted.forEach((l) => l(stamp));
  }
}

/** Скільки сторінок присутності відкрито; поки > 0 — слухаємо `moment:stamp` (як раніше «сервер» імітації). */
let surfaces = 0;
let offMoment: (() => void) | null = null;
function holdMomentListener(): () => void {
  startClaims();
  surfaces += 1;
  if (!offMoment) offMoment = on('moment:stamp', claimFromMoment);
  return () => {
    surfaces -= 1;
    if (surfaces === 0 && offMoment) {
      offMoment();
      offMoment = null;
    }
  };
}

const subscribeClaims = (cb: () => void) => claimer.subscribe(cb);
const claimsSnapshot = () => claimer.snapshot();
const EMPTY_CLAIMS: ClaimsSnapshot = { pending: [], unconfirmed: [] };
const serverClaims = () => EMPTY_CLAIMS;

/** Свої штампи разом із тими, що чекають підтвердження сервера (показуємо однаково). */
function mergeStamps(server: readonly Stamp[], claims: ClaimsSnapshot): readonly Stamp[] {
  if (!claims.pending.length) return server;
  const ids = new Set(server.map((x) => x.eventId));
  const extra = claims.pending.filter((p) => !ids.has(p.stamp.eventId)).map((p) => p.stamp);
  return extra.length ? [...server, ...extra] : server;
}

export function useStamps(): readonly Stamp[] {
  const server = useResource(passportStamps).data ?? EMPTY;
  const claims = useSyncExternalStore(subscribeClaims, claimsSnapshot, serverClaims);
  useEffect(() => startClaims(), []);
  return useMemo(() => mergeStamps(server, claims), [server, claims]);
}

/** Події, чиї штампи сервер не підтвердив довше хвилини (тихий рядок «Штамп збережено на цьому пристрої…»). */
export function useUnconfirmedStamps(): readonly string[] {
  return useSyncExternalStore(subscribeClaims, claimsSnapshot, serverClaims).unconfirmed;
}

/** «Скинути стан гостя», тести: забути непідтверджені штампи. */
export function resetStampClaims(): void {
  claimer.reset();
}

/** Чи є штамп за подію. */
export function useHasStamp(eventId: string | null | undefined): boolean {
  const stamps = useStamps();
  return eventId ? stamps.some((x) => x.eventId === eventId) : false;
}

/** Штамп за подію (або `undefined`). */
export function useStampOf(eventId: string | null | undefined): Stamp | undefined {
  const stamps = useStamps();
  return eventId ? stamps.find((x) => x.eventId === eventId) : undefined;
}

/** Свої штампи поза React (обробники, вікна) — разом із тими, що чекають підтвердження. */
export function currentStamps(): readonly Stamp[] {
  return mergeStamps(passportStamps.getSnapshot().data ?? EMPTY, claimer.snapshot());
}

export interface PresenceSurfaceProps {
  source: PresenceSource;
  eventIds: readonly string[];
}

/**
 * Сторінка, що показує подію (ефір, країна, кімната, ТВ). `null` — сторінка нічого не показує, але штампи за подію, від
 * якої щойно пішли, однаково видаються.
 */
export function usePresence(surface: PresenceSurfaceProps | null): void {
  const clock = useClock();
  const source = surface?.source ?? null;
  const key = surface ? surface.eventIds.join('|') : '';
  const opened = useRef(new Map<string, Ms>());
  useEffect(() => {
    const release = holdMomentListener();
    const off = getService('passport').trackPresence(source && key ? { source, eventIds: key.split('|'), openedAt: opened.current } : null, {
      now: () => clock.getSnapshot(),
      fallbackNow: () => clock.source.now(),
      subscribe: (cb) => clock.subscribe(cb),
    });
    return () => {
      off();
      release();
    };
  }, [clock, source, key]);
}

/**
 * Підписка поза хуком (ефекти з власними залежностями): кожен щойно виданий штамп, синхронно — з’явився на пристрої
 * (опівночі, ще до підтвердження сервера) чи прийшов від сервера; той самий штамп — раз.
 */
export function onStampGranted(cb: (stamp: Stamp) => void): () => void {
  const seen = new Set<string>();
  const once = (stamp: Stamp) => {
    if (seen.has(stamp.eventId)) return;
    seen.add(stamp.eventId);
    cb(stamp);
  };
  localGranted.add(once);
  const off = getService('passport').subscribe((e) => {
    if (e.type === 'granted') return once(e.stamp);
    // Скидання гостя: штампи, яких більше немає (і які не чекають підтвердження), можна святкувати знову.
    const kept = new Set([...e.stamps.map((x) => x.eventId), ...claimer.snapshot().pending.map((x) => x.stamp.eventId)]);
    [...seen].forEach((id) => !kept.has(id) && seen.delete(id));
  });
  return () => {
    localGranted.delete(once);
    off();
  };
}

/** Кожен щойно виданий штамп (синхронно, в тому ж такті, що й видача). */
export function useStampGranted(onGranted: (stamp: Stamp) => void): void {
  const cb = useRef(onGranted);
  useEffect(() => {
    cb.current = onGranted;
  });
  useEffect(() => onStampGranted((stamp) => cb.current(stamp)), []);
}
