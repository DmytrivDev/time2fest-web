'use client';

/**
 * BroadcastController (ІНВ 4.1 «Фаза події», T068): ОДИН на макет `(live)`, поруч із `PlayerProvider`.
 *
 * - раз на секунду від спільного годинника рахує подію ефіру (`currentAirEvent`) і фазу підпису (`captionPhase`);
 *   сторінки (головна, ТВ) лише читають `useBroadcast()` — тож показують те саме;
 * - на поверхні ефіру (`/`, `/tv`) задає ланцюжок плеєра `setChain` з `data/streams.json`; перехід ефіру на «+15 хв»
 *   — це просто новий ланцюжок: `PlayerProvider` міняє відео через `loadVideoById` у тому самому iframe
 *   або ховає хост, якщо в наступної події трансляції немає (сцена відліку на місці плеєра);
 * - «Лишитися тут ›» (`stayHere`) запам’ятовує подію й веде на сторінку країни клієнтським переходом: макет не
 *   перемонтовується, а поза поверхнею ефіру контролер ланцюжок не чіпає — відео не перезапускається (SC-003);
 * - монтує `EngineScheduler` (перепади → події шини) з присутністю зі сторінок (`surfacePresence`);
 * - режим вечірки (ТВ, рішення 2026-11-06): «Мій графік» (`setPrefer`) — у слоті ефіру подія з графіка гостя, якщо є;
 *   «Змінити трансляцію» / «Перемкнути» (`watch`) — обрана трансляція грає до наступної передачі ефіру, далі знову автопілот.
 */
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getStreamChains, useStreamChains, withChains } from '@/lib/api/hooks/live';
import { patchedData, usePatchedData } from '@/lib/api/hooks/site';
import type { City, Country, Dataset, Ms, ScheduledEvent, StreamChain } from '@/lib/data/types';
import { captionPhase, type CaptionPhase, toRuntime } from '@time2fest/rules/time';
import { currentAirEvent, pickSlotEvent, type AirState } from '@/lib/engine/currentAirEvent';
import { EngineScheduler } from '@/lib/events/EngineSchedulerMount';
import { countryHref } from '@/lib/live/countryHref';
import { isRateInteracting } from '@/lib/live/rateInteraction';
import { buildOfferContext } from '@/lib/offers/context';
import { surfacePresence } from '@/lib/presence/surfaces';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { usePlayerActions } from './PlayerProvider';

/** Маршрути, де ефір сам веде плеєр (головна й ТВ). */
export const BROADCAST_PATHS: readonly string[] = ['/', '/tv'];

export function isBroadcastPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return BROADCAST_PATHS.includes(p);
}

export { countryHref };

export interface AirPlace {
  event: ScheduledEvent;
  city: City | undefined;
  country: Country | undefined;
  /** Сторінка країни події. */
  href: string | null;
}

export interface BroadcastState {
  /** `false` — час ще невідомий (статичний рендер, гідратація): показуємо скелетон, плеєр не задаємо. */
  ready: boolean;
  now: Ms;
  air: AirState | null;
  phase: CaptionPhase | null;
  current: AirPlace | null;
  next: AirPlace | null;
  /** Ланцюжок джерел поточної події (порожній — трансляції немає). */
  chain: StreamChain | null;
  /** Ефір зараз керує плеєром (поверхня ефіру). */
  controlling: boolean;
  /** «Лишитися тут ›»: запам’ятати подію перед переходом на сторінку країни. */
  stayHere(): void;
  /** Обрана гостем трансляція (ТВ, «Змінити трансляцію»), поки вона діє; `null` — грає ефір. */
  watching: WatchingPlace | null;
  /** Дивитися іншу трансляцію до наступної передачі ефіру; `null` — повернутися до ефіру. */
  watch(pick: WatchPick | null): void;
  /** «Мій графік» (ТВ): id подій графіка, з яких ефір бере подію слота; `null` — «Усе свято». */
  setPrefer(ids: readonly string[] | null): void;
  /** Не вести плеєр (`/tv` на телефоні — інформаційна сторінка без відео). */
  suspend(on: boolean): void;
}

export interface WatchPick {
  eventId: string;
  /** Джерело, з якого почати (решта ланцюжка — запасні). */
  sourceId?: string;
}

export interface WatchingPlace extends AirPlace {
  sourceId: string | null;
}

const BroadcastContext = createContext<BroadcastState | null>(null);

/** Закриття оцінки за часом відкладається, поки людина працює з карткою (WCAG 2.2.1). */
const RATE_DEPS = { isInteracting: () => isRateInteracting() };

function placeOf(event: ScheduledEvent | null | undefined, data: Dataset): AirPlace | null {
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  return {
    event: data.eventsById.get(event.id) ?? event,
    city: data.citiesById.get(event.cityId),
    country,
    href: country ? countryHref(country, { eventId: event.id }) : null,
  };
}

/**
 * «Мій графік»: подія слота ефіру з графіка гостя (той самий вибір, що й в ефірі); поза графіком — ефір як є.
 * `data` — каталог з поправками моменту подій (знімок `site`).
 */
export function preferAir(
  now: Ms,
  air: AirState,
  ids: readonly string[],
  chains: ReadonlyMap<string, StreamChain> = getStreamChains(),
  data: Dataset = patchedData(),
): AirState {
  if (!air.event || !ids.length) return air;
  const slot = data.eventsBySlot.find((s) => s.midnightMs === air.event!.midnightMs);
  const mine = slot?.events.filter((e) => ids.includes(e.id)) ?? [];
  const pick = mine.length ? pickSlotEvent(now, mine, data.countriesByIso, chains) : null;
  if (!pick) return air;
  return { ...air, event: toRuntime(now, pick.event), source: pick.source, view: pick.view };
}

/** Ланцюжок обраної трансляції: обране джерело — бажане (`preferredSourceId`), решта — запасні. */
export function watchChain(pick: WatchPick, chains: ReadonlyMap<string, StreamChain> = getStreamChains()): (StreamChain & { preferredSourceId?: string }) | null {
  const chain = chains.get(pick.eventId);
  if (!chain?.sources.length) return null;
  return { eventId: pick.eventId, sources: chain.sources, ...(pick.sourceId ? { preferredSourceId: pick.sourceId } : {}) };
}

/**
 * Чистий розрахунок стану ефіру для `now` (без React): подія, наступна, фаза підпису, ланцюжок. `data` — каталог з
 * поправками моменту подій (знімок `site`, AC-54): виправлений момент веде перехід ефіру.
 */
export function computeBroadcast(
  now: Ms,
  prefer?: readonly string[] | null,
  chains: ReadonlyMap<string, StreamChain> = getStreamChains(),
  data: Dataset = patchedData(),
): Pick<BroadcastState, 'air' | 'phase' | 'current' | 'next' | 'chain'> {
  const base = currentAirEvent(now, data, chains);
  const air = prefer?.length ? preferAir(now, base, prefer, chains, data) : base;
  const phase = air.event ? captionPhase(now, air.event, 'broadcast', air.nextEvent) : null;
  return {
    air,
    phase,
    current: placeOf(air.event, data),
    next: placeOf(air.nextEvent, data),
    chain: air.event ? (chains.get(air.event.id) ?? { eventId: air.event.id, sources: [] }) : null,
  };
}

export function BroadcastController({ children }: { children?: ReactNode }) {
  const ready = useTimeReady();
  const now = useNow();
  const known = ready && now > 0;
  const pathname = usePathname();
  const controlling = isBroadcastPath(pathname);
  const { setChain, setFacebookConsent } = usePlayerActions();
  const facebookConsent = useGuestStore((s) => s.consent.facebookVideo);
  // Ланцюжки джерел з шва `live`: стартово зі збірки, далі поправки сервера (статус, вбудовування).
  const chains = useStreamChains();
  // Каталог з поправками моменту подій (знімок `site`); без поправок — сам `getData()`.
  const data = usePatchedData();

  // `/tv` починає «на паузі»: сторінка сама знімає її, коли знає, що це не телефон (інакше iframe встиг би створитися).
  const [suspended, suspend] = useState(() => pathname?.replace(/\/+$/, '') === '/tv');
  const [prefer, setPreferState] = useState<readonly string[] | null>(null);
  const setPrefer = useCallback((ids: readonly string[] | null) => {
    setPreferState((cur) => (ids === cur || (ids && cur && ids.length === cur.length && ids.every((x, i) => x === cur[i])) ? cur : ids));
  }, []);

  // Ефір змінюється раз на слот, а не щосекунди: розрахунок дешевий, але ланцюжок порівнюємо за id події.
  const computed = useMemo(() => (known ? computeBroadcast(now, prefer, chains, data) : null), [known, now, prefer, chains, data]);
  const eventId = computed?.air?.event?.id ?? null;
  const chain = computed?.chain ?? null;

  // Обрана трансляція діє до передачі ефіру, під час якої її обрали.
  const [pick, setPick] = useState<(WatchPick & { until: Ms }) | null>(null);
  const handoverAt = computed?.air?.handoverAt ?? null;
  const watch = useCallback(
    (p: WatchPick | null) => setPick(p && handoverAt !== null ? { ...p, until: handoverAt } : null),
    [handoverAt],
  );
  const active = pick && known && now < pick.until ? pick : null;
  const watchKey = active ? `${active.eventId}|${active.sourceId ?? ''}` : null;
  const watching = useMemo<WatchingPlace | null>(() => {
    if (!watchKey) return null;
    const [ev, src] = watchKey.split('|');
    const event = data.eventsById.get(ev!);
    const place = event ? placeOf(event, data) : null;
    return place ? { ...place, sourceId: src || null } : null;
  }, [watchKey, data]);

  useEffect(() => {
    setFacebookConsent(facebookConsent);
  }, [facebookConsent, setFacebookConsent]);

  // Поверхня ефіру: ланцюжок поточної події. Поза нею (сторінка країни, кімната) — не чіпаємо.
  useEffect(() => {
    if (!controlling || !known) return;
    if (suspended) {
      setChain(null);
      return;
    }
    if (watchKey) {
      const [ev, src] = watchKey.split('|');
      const picked = watchChain({ eventId: ev!, sourceId: src || undefined }, chains);
      if (picked) {
        setChain(picked);
        return;
      }
    }
    if (!eventId || !chain) {
      setChain(null);
      return;
    }
    // Головне святкування (`kind: 'main'`), якщо є: ще не почалось — заглушка «Очікуйте трансляцію» (2026-11-11), і коли
    // час початку невідомий чи вже минув (2026-11-13), а не інша трансляція.
    const main = chain.sources.find((x) => x.kind === 'main');
    setChain(main ? { eventId, sources: chain.sources, preferredSourceId: main.id, waitForPreferred: true } : { eventId, sources: chain.sources });
  }, [controlling, known, suspended, eventId, chain, chains, watchKey, setChain]);

  const stayed = useRef<string | null>(null);
  const controllingRef = useRef(controlling);
  const eventRef = useRef(eventId);
  useEffect(() => {
    controllingRef.current = controlling;
    eventRef.current = eventId;
    if (controlling) stayed.current = null; // повернулися на головну — ефір знову веде плеєр
  }, [controlling, eventId]);

  const stayHere = useCallback(() => {
    stayed.current = eventRef.current;
  }, []);
  /** Для `air:handover.stayedHere`: гість лишився на сторінці країни з подією, з якої переходить ефір. */
  const stayedHere = useCallback(() => stayed.current !== null && !controllingRef.current, []);

  // Слоти планувальника — з виправленими моментами; без поправок `eventsBySlot` той самий, і планувальник не перестворюється.
  const schedulerData = useMemo(() => withChains(data, chains), [data, chains]);

  const value = useMemo<BroadcastState>(
    () => ({
      ready: known,
      now,
      air: computed?.air ?? null,
      phase: computed?.phase ?? null,
      current: computed?.current ?? null,
      next: computed?.next ?? null,
      chain,
      controlling,
      stayHere,
      watching,
      watch,
      setPrefer,
      suspend,
    }),
    [known, now, computed, chain, controlling, stayHere, watching, watch, setPrefer],
  );

  return (
    <BroadcastContext.Provider value={value}>
      <EngineScheduler data={schedulerData} getPresence={surfacePresence} stayedHere={stayedHere} rate={RATE_DEPS} getOfferContext={buildOfferContext} />
      {children}
    </BroadcastContext.Provider>
  );
}

export function useBroadcast(): BroadcastState {
  const v = useContext(BroadcastContext);
  if (!v) throw new Error('useBroadcast: потрібен <BroadcastController> (app/(live)/layout.tsx)');
  return v;
}

/** Без контролера — `null` (історії, юніт-тести компонентів). */
export function useOptionalBroadcast(): BroadcastState | null {
  return useContext(BroadcastContext);
}

export { BroadcastContext };
