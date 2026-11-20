/**
 * Адаптер `sim` домену «Паспорт» (`docs/backend/frontend-seam.md`, E5b): «сервер» штампів у вкладці.
 * - Присутність: поверхні сторінок у реєстрі (`lib/presence/surfaces`) і запис `guest.pendingPresence` на кожному такті
 *   годинника сайту (`presenceOf`, `presenceMoment` — чисті правила `lib/engine/presence`), як раніше `useStampGrant`.
 * - Штамп: на `moment:stamp` (+15 с після півночі, `EngineScheduler`) клієнт показує штамп і просить підтвердження
 *   (`claim`, `lib/api/hooks/passport` → `lib/passport/stampClaims`, 2026-11-14) — «сервер» записує його в `guest.stamps`
 *   (`buildStamp`, один на подію). Відмову видно засобами `?simFail=passport.claim:network`.
 * - Події: зміна `guest.stamps` → `granted` (нові) чи `snapshot` (скидання).
 */
import { ok, fail } from '../result';
import type { PassportEvent, PassportService, PresenceClock, PresenceSurfaceInput } from '../contracts/passport';
import { patchedData } from '../hooks/site';
import { getData } from '@/lib/data/load';
import type { Ms, PresenceSource, Stamp } from '@/lib/data/types';
import { buildStamp } from '@/lib/engine/stamp';
import { presenceMoment, presenceOf, type PresenceSurface } from '@time2fest/rules/time';
import type { MomentStamp } from '@/lib/events/types';
import { registerSurface } from '@/lib/presence/surfaces';
import { useGuestStore } from '@/stores/guest';

/** Видати штампи за кожну подію з `moment:stamp`, де гість був присутній (тести; на сайті — `claim` з клієнта). Повертає id виданих. */
export function grantStamps(payload: MomentStamp): string[] {
  const data = patchedData();
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

/** «Сервер» записує штамп за подію (один на подію); уже є — той самий. */
export function grantStamp(eventId: string, source: PresenceSource): Stamp | null {
  const data = patchedData();
  const event = data.eventsById.get(eventId);
  if (!event) return null;
  const guest = useGuestStore.getState();
  const had = guest.stamps.find((x) => x.eventId === eventId);
  if (had) return had;
  const stamp = buildStamp({ event, country: data.countriesByIso.get(event.countryIso), city: data.citiesById.get(event.cityId), presenceSource: source });
  guest.addStamp(stamp);
  return stamp;
}

function trackPresence(surface: PresenceSurfaceInput | null, clock: PresenceClock): () => void {
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

export function createSimPassport(): PassportService {
  return {
    async stamps() {
      return ok(useGuestStore.getState().stamps);
    },
    peek: () => useGuestStore.getState().stamps,
    subscribe(onEvent: (event: PassportEvent) => void) {
      return useGuestStore.subscribe((s, p) => {
        if (s.stamps === p.stamps) return;
        const before = new Set(p.stamps.map((x) => x.eventId));
        const fresh = s.stamps.filter((x) => !before.has(x.eventId));
        // Лише додано — `granted` (по одному, синхронно); щось зникло (скидання гостя, нова ніч) — увесь список.
        if (fresh.length + p.stamps.length === s.stamps.length) fresh.forEach((stamp) => onEvent({ type: 'granted', stamp }));
        else onEvent({ type: 'snapshot', stamps: s.stamps });
      });
    },
    trackPresence,
    async claim(req) {
      const stamp = grantStamp(req.eventId, req.source);
      return stamp ? ok(stamp) : fail('not_found');
    },
    async beat() {
      // `sim` не шле пульсів — присутність рахує `trackPresence` на кожному такті.
      return fail('unavailable', { reason: 'sim-uses-trackPresence' });
    },
  };
}
