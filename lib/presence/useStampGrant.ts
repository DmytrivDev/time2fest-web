'use client';

/**
 * Нарахування штампа за присутність (T070, FR-060, `contracts/ui-events.md` — `moment:stamp`).
 *
 * - Сторінка, що показує подію (ефір, країна, кімната, ТВ), викликає `useStampGrant({ source, eventIds })`:
 *   поверхня реєструється в модульному реєстрі, а на кожному такті спільного годинника присутність
 *   (`presenceOf`) записується в `guest.pendingPresence` — тож піти між північчю й «+15 с» можна.
 * - `surfacePresence(eventIds, at)` — для `EngineScheduler.getPresence`: реєстр + `pendingPresence`, тож
 *   штамп нараховується навіть тоді, коли такт перескочив через північ (машина часу, сон вкладки).
 * - Хук слухає `moment:stamp` і пише штамп у `guest.stamps` (один на подію; повтор ігнорується).
 */
import { useEffect, useRef } from 'react';
import type { Ms, PresenceSource } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { buildStamp, presenceMoment, presenceOf, presentEvents, type PresenceSurface } from '@/lib/engine/presence';
import { on } from '@/lib/events/bus';
import type { MomentStamp } from '@/lib/events/types';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';

export interface StampSurfaceInput {
  source: PresenceSource;
  eventIds: readonly string[];
}

/** Відкриті поверхні сторінок (одна вкладка = один реєстр). */
const registry = new Map<number, PresenceSurface>();
let seq = 0;

/** Для тестів: очистити реєстр. */
export function clearPresenceRegistry(): void {
  registry.clear();
}

export function registerSurface(surface: PresenceSurface): () => void {
  const id = ++seq;
  registry.set(id, surface);
  return () => {
    registry.delete(id);
  };
}

/** Присутність за подіями в момент `at`: відкриті поверхні + уже зафіксоване в стані гостя. */
export function surfacePresence(eventIds: readonly string[], at: Ms): Record<string, PresenceSource> {
  const data = getData();
  const events = eventIds.map((id) => data.eventsById.get(id)).filter((e) => e !== undefined);
  const live = presentEvents([...registry.values()], events, at);
  const pending = useGuestStore.getState().pendingPresence;
  const out: Record<string, PresenceSource> = {};
  for (const id of eventIds) {
    const p = pending[id];
    if (p && p.at <= at) out[id] = p.source;
    else if (live[id]) out[id] = live[id];
  }
  return out;
}

/** Обробник `moment:stamp`: штамп за кожну подію, де гість був присутній. */
export function grantStamps(payload: MomentStamp): string[] {
  const data = getData();
  const guest = useGuestStore.getState();
  const granted: string[] = [];
  for (const id of payload.presentEventIds) {
    const event = data.eventsById.get(id);
    if (!event) continue;
    const stamp = buildStamp({
      event,
      country: data.countriesByIso.get(event.countryIso),
      city: data.citiesById.get(event.cityId),
      presenceSource: payload.presenceSources[id] ?? 'air',
    });
    if (guest.addStamp(stamp)) granted.push(id);
  }
  return granted;
}

/**
 * Поверхня сторінки: реєструє присутність на `eventIds` і нараховує штамп за `moment:stamp`.
 * `null` — сторінка нічого не показує (присутності немає), але штампи за подію все одно пишуться.
 */
export function useStampGrant(surface: StampSurfaceInput | null): void {
  const clock = useClock();
  const source = surface?.source ?? null;
  const key = surface ? surface.eventIds.join('|') : '';
  const opened = useRef(new Map<string, Ms>());

  // Реєстр поверхонь: одна поверхня на подію, `openedAt` — коли сторінка почала її показувати.
  useEffect(() => {
    if (!source || !key) return;
    const ids = key.split('|');
    const now = clock.getSnapshot() || clock.source.now();
    const unregister: (() => void)[] = [];
    const entries: PresenceSurface[] = [];
    const keep = new Map<string, Ms>();
    for (const id of ids) {
      const openedAt = opened.current.get(id) ?? now;
      keep.set(id, openedAt);
      const entry: PresenceSurface = { source, eventIds: [id], openedAt };
      entries.push(entry);
      unregister.push(registerSurface(entry));
    }
    opened.current = keep;

    const data = getData();
    const mark = () => {
      const t = clock.getSnapshot();
      const { pendingPresence, markPresence } = useGuestStore.getState();
      for (const entry of entries) {
        const id = entry.eventIds[0]!;
        // Машина часу перемотала назад: сторінка була відкрита весь цей час, тож «відкрита» не пізніше за `t`.
        if (t < entry.openedAt) {
          entry.openedAt = t;
          opened.current.set(id, t);
        }
        if (pendingPresence[id]) continue;
        const event = data.eventsById.get(id);
        if (!event || !presenceOf(entry, t, event)) continue;
        markPresence(id, presenceMoment(entry, event), entry.source);
      }
    };
    mark();
    const unsubscribe = clock.subscribe(mark);
    return () => {
      mark();
      unsubscribe();
      unregister.forEach((u) => u());
    };
  }, [clock, source, key]);

  useEffect(() => on('moment:stamp', (payload) => void grantStamps(payload)), []);
}
