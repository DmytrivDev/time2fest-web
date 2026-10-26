'use client';

/**
 * `EngineScheduler` — один на сеанс (у `LiveShell`). Підписується на спільний годинник
 * `TimeProvider` і на кожному такті викликає ядро `createEngineScheduler`, що емітує
 * події шини (`moment:*`, `air:*`, `offer:show`). Нічого не рендерить.
 *
 * Типові залежності беруться зі стану гостя: присутність — `pendingPresence`,
 * штампи — `stamps`, закрита оцінка — `rate[eventId].closed`.
 */
import { useEffect, useRef } from 'react';
import type { PresenceSource } from '@/lib/data/types';
import { useClock } from '@/lib/time/TimeProvider';
import { safeSessionStorage } from '@/lib/time/params';
import { useGuestStore } from '@/stores/guest';
import { emit } from './bus';
import { createEngineScheduler, type SchedulerData, type SchedulerDeps } from './engineScheduler';

export interface EngineSchedulerProps extends Partial<Omit<SchedulerDeps, 'data' | 'emit' | 'storage'>> {
  /** Розклад і ланцюжки (зазвичай `data` з `lib/data/load`). */
  data: SchedulerData;
}

function guestPresence(eventIds: string[]): Record<string, PresenceSource> {
  const pending = useGuestStore.getState().pendingPresence;
  const out: Record<string, PresenceSource> = {};
  for (const id of eventIds) {
    const p = pending[id];
    if (p) out[id] = p.source;
  }
  return out;
}

function guestStamped(eventIds: string[]): string[] {
  const stamps = useGuestStore.getState().stamps;
  return eventIds.filter((id) => stamps.some((s) => s.eventId === id));
}

function guestRateClosed(eventIds: string[]): boolean {
  const rate = useGuestStore.getState().rate;
  return eventIds.length > 0 && eventIds.every((id) => rate[id]?.closed === true);
}

export function EngineScheduler(props: EngineSchedulerProps) {
  const clock = useClock();
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const { data } = props;
  useEffect(() => {
    const p = () => propsRef.current;
    const scheduler = createEngineScheduler({
      data,
      emit,
      storage: safeSessionStorage(),
      getPresence: (ids, at) => (p().getPresence ?? guestPresence)(ids, at),
      getStampedEventIds: (ids) => (p().getStampedEventIds ?? guestStamped)(ids),
      rate: {
        isInteracting: (ids) => p().rate?.isInteracting?.(ids) ?? false,
        isClosed: (ids) => (p().rate?.isClosed ?? guestRateClosed)(ids),
      },
      getOfferContext: (now) => p().getOfferContext?.(now) ?? null,
      stayedHere: () => p().stayedHere?.() ?? false,
    });
    const run = () => scheduler.tick(clock.getSnapshot());
    const unsubscribe = clock.subscribe(run);
    run();
    return unsubscribe;
  }, [clock, data]);

  return null;
}
