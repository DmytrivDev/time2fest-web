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
 * - монтує `EngineScheduler` (перепади → події шини) з присутністю зі сторінок (`surfacePresence`).
 */
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { City, Country, Ms, ScheduledEvent, StreamChain } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { captionPhase, type CaptionPhase } from '@/lib/engine/captionPhase';
import { currentAirEvent, type AirState } from '@/lib/engine/currentAirEvent';
import { EngineScheduler } from '@/lib/events/EngineSchedulerMount';
import { isRateInteracting } from '@/lib/live/rateInteraction';
import { buildOfferContext } from '@/lib/offers/context';
import { surfacePresence } from '@/lib/presence/useStampGrant';
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

/** Сторінка країни (зі скісною рискою в кінці — `trailingSlash: true`). */
export function countryHref(country: Pick<Country, 'slug'>): string {
  return `/country/${country.slug}/`;
}

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
}

const BroadcastContext = createContext<BroadcastState | null>(null);

/** Закриття оцінки за часом відкладається, поки людина працює з карткою (WCAG 2.2.1). */
const RATE_DEPS = { isInteracting: () => isRateInteracting() };

function placeOf(event: ScheduledEvent | null | undefined): AirPlace | null {
  if (!event) return null;
  const data = getData();
  const country = data.countriesByIso.get(event.countryIso);
  return {
    event: data.eventsById.get(event.id) ?? event,
    city: data.citiesById.get(event.cityId),
    country,
    href: country ? countryHref(country) : null,
  };
}

/** Чистий розрахунок стану ефіру для `now` (без React): подія, наступна, фаза підпису, ланцюжок. */
export function computeBroadcast(now: Ms): Pick<BroadcastState, 'air' | 'phase' | 'current' | 'next' | 'chain'> {
  const data = getData();
  const air = currentAirEvent(now, data, data.chainsByEventId);
  const phase = air.event ? captionPhase(now, air.event, 'broadcast', air.nextEvent) : null;
  return {
    air,
    phase,
    current: placeOf(air.event),
    next: placeOf(air.nextEvent),
    chain: air.event ? (data.chainsByEventId.get(air.event.id) ?? { eventId: air.event.id, sources: [] }) : null,
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

  // Ефір змінюється раз на слот, а не щосекунди: розрахунок дешевий, але ланцюжок порівнюємо за id події.
  const computed = useMemo(() => (known ? computeBroadcast(now) : null), [known, now]);
  const eventId = computed?.air?.event?.id ?? null;
  const chain = computed?.chain ?? null;

  useEffect(() => {
    setFacebookConsent(facebookConsent);
  }, [facebookConsent, setFacebookConsent]);

  // Поверхня ефіру: ланцюжок поточної події. Поза нею (сторінка країни, кімната) — не чіпаємо.
  useEffect(() => {
    if (!controlling || !known) return;
    if (!eventId || !chain) {
      setChain(null);
      return;
    }
    setChain({ eventId, sources: chain.sources });
  }, [controlling, known, eventId, chain, setChain]);

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
    }),
    [known, now, computed, chain, controlling, stayHere],
  );

  return (
    <BroadcastContext.Provider value={value}>
      <EngineScheduler data={getData()} getPresence={surfacePresence} stayedHere={stayedHere} rate={RATE_DEPS} getOfferContext={buildOfferContext} />
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
