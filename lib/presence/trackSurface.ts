/**
 * Локальна присутність сторінки (спільна для адаптерів `sim` і `http` домену «Паспорт»): поверхні в реєстрі
 * (`./surfaces`) і запис `guest.pendingPresence` на кожному такті годинника сайту — чисті правила `lib/engine/presence`.
 * Адаптер `http` додає до цього пульси `beat`; штамп видає сервер.
 */
import type { PresenceClock, PresenceSurfaceInput } from '@/lib/api/contracts/passport';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { presenceMoment, presenceOf, type PresenceSurface } from '@time2fest/rules/time';
import { registerSurface } from '@/lib/presence/surfaces';
import { useGuestStore } from '@/stores/guest';

export function trackSurfaceLocally(surface: PresenceSurfaceInput | null, clock: PresenceClock): () => void {
  const release = () => undefined;
  if (!surface || !surface.eventIds.length) return release;

  const now = clock.now() || clock.fallbackNow();
  const entries: PresenceSurface[] = [];
  const unregister: (() => void)[] = [];
  const keep = new Map<string, Ms>();
  for (const id of surface.eventIds) {
    const openedAt = surface.openedAt.get(id) ?? now;
    keep.set(id, openedAt);
    const entry: PresenceSurface = { source: surface.source, eventIds: [id], openedAt };
    entries.push(entry);
    unregister.push(registerSurface(entry));
  }
  surface.openedAt.clear();
  keep.forEach((v, k) => surface.openedAt.set(k, v));

  const data = getData();
  const mark = () => {
    const t = clock.now();
    const { pendingPresence, markPresence } = useGuestStore.getState();
    for (const entry of entries) {
      const id = entry.eventIds[0]!;
      // Машина часу перемотала назад: сторінка була відкрита весь цей час, тож «відкрита» не пізніше за `t`.
      if (t < entry.openedAt) {
        entry.openedAt = t;
        surface.openedAt.set(id, t);
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
    release();
  };
}
