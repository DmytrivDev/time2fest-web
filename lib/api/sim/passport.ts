/**
 * Адаптер `sim` домену «Паспорт» (`docs/backend/frontend-seam.md`, E5b): «сервер» штампів у вкладці.
 * - Присутність: поверхні сторінок у реєстрі (`lib/presence/surfaces`) і запис `guest.pendingPresence` на кожному такті
 *   годинника сайту (`presenceOf`, `presenceMoment` — чисті правила `lib/engine/presence`), як раніше `useStampGrant`.
 * - Штамп: на `moment:stamp` (+15 с після півночі, `EngineScheduler`) — за кожну подію, де гість був присутній
 *   (`buildStamp`), у `guest.stamps` (один на подію). Як і раніше, слухаємо лише поки відкрита хоч одна сторінка
 *   ефіру / країни / кімнати / ТВ (вони викликають `trackPresence`, навіть без події — `null`).
 * - Події: зміна `guest.stamps` → `granted` (нові) чи `snapshot` (скидання).
 */
import { ok, fail } from '../result';
import type { PassportEvent, PassportService, PresenceClock, PresenceSurfaceInput } from '../contracts/passport';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { buildStamp, presenceMoment, presenceOf, type PresenceSurface } from '@/lib/engine/presence';
import { on } from '@/lib/events/bus';
import type { MomentStamp } from '@/lib/events/types';
import { registerSurface } from '@/lib/presence/surfaces';
import { useGuestStore } from '@/stores/guest';

/** Обробник `moment:stamp`: штамп за кожну подію, де гість був присутній. Повертає id виданих. */
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

/** Скільки сторінок присутності відкрито; поки > 0 — «сервер» видає штампи. */
let open = 0;
let offGrant: (() => void) | null = null;

function trackPresence(surface: PresenceSurfaceInput | null, clock: PresenceClock): () => void {
  open += 1;
  if (!offGrant) offGrant = on('moment:stamp', (payload) => void grantStamps(payload));
  const release = () => {
    open -= 1;
    if (open === 0 && offGrant) {
      offGrant();
      offGrant = null;
    }
  };
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
    async beat() {
      // `sim` не шле пульсів — присутність рахує `trackPresence` на кожному такті.
      return fail('unavailable', { reason: 'sim-uses-trackPresence' });
    },
  };
}
