'use client';

/**
 * Хуки домену «Паспорт» (`docs/backend/frontend-seam.md`, E5b) — єдине, що бачать компоненти.
 * - `usePresence(surface)` — сторінка показує події (колишній `useStampGrant`): присутність іде в сервіс, штамп видає сервіс.
 * - `useStamps()` — свої штампи (ресурс з `peek`: перший кадр після гідратації вже з паспортом, без «порожньо на мить»).
 * - `useStampGranted(cb)` — щойно видані штампи (свято в шапці).
 */
import { useEffect, useRef } from 'react';
import { applyPassportEvent, type PassportEvent } from '../contracts/passport';
import { createResource, useResource } from '../resource';
import { getService } from '../services';
import type { Ms, PresenceSource, Stamp } from '@/lib/data/types';
import { useClock } from '@/lib/time/TimeProvider';

const EMPTY: readonly Stamp[] = [];

export const passportStamps = createResource<readonly Stamp[], PassportEvent>(() => {
  const svc = getService('passport');
  return { load: () => svc.stamps(), subscribe: (cb) => svc.subscribe(cb), reduce: applyPassportEvent, peek: () => svc.peek?.() };
});

export function useStamps(): readonly Stamp[] {
  return useResource(passportStamps).data ?? EMPTY;
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

/** Свої штампи поза React (обробники, вікна). */
export function currentStamps(): readonly Stamp[] {
  return passportStamps.getSnapshot().data ?? EMPTY;
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
  useEffect(
    () =>
      getService('passport').trackPresence(source && key ? { source, eventIds: key.split('|'), openedAt: opened.current } : null, {
        now: () => clock.getSnapshot(),
        fallbackNow: () => clock.source.now(),
        subscribe: (cb) => clock.subscribe(cb),
      }),
    [clock, source, key],
  );
}

/** Підписка поза хуком (ефекти з власними залежностями): кожен щойно виданий штамп, синхронно. */
export function onStampGranted(cb: (stamp: Stamp) => void): () => void {
  return getService('passport').subscribe((e) => {
    if (e.type === 'granted') cb(e.stamp);
  });
}

/** Кожен щойно виданий штамп (синхронно, в тому ж такті, що й видача). */
export function useStampGranted(onGranted: (stamp: Stamp) => void): void {
  const cb = useRef(onGranted);
  useEffect(() => {
    cb.current = onGranted;
  });
  useEffect(
    () =>
      getService('passport').subscribe((e) => {
        if (e.type === 'granted') cb.current(e.stamp);
      }),
    [],
  );
}
