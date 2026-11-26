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
import type { PassportEvent, PassportService } from '../contracts/passport';
import { patchedData } from '../hooks/site';
import type { PresenceSource, Stamp } from '@/lib/data/types';
import { buildStamp } from '@/lib/engine/stamp';
import { ratingCloseAt } from '@time2fest/rules/time';
import type { MomentStamp } from '@/lib/events/types';
import { surfacePresence } from '@/lib/presence/surfaces';
import { trackSurfaceLocally } from '@/lib/presence/trackSurface';
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
    trackPresence: trackSurfaceLocally,
    async claim(req) {
      const data = patchedData();
      const event = data.eventsById.get(req.eventId);
      if (!event) return fail('not_found', { reason: 'unknown-event' });
      // Уже виданий штамп повертаємо той самий (ідемпотентно), навіть коли вікно закрите.
      const had = useGuestStore.getState().stamps.find((x) => x.eventId === req.eventId);
      if (had) return ok(had);
      if (req.at >= ratingCloseAt(data)) return fail('conflict', { reason: 'claim-closed' });
      // Без присутності на пристрої (реєстр поверхонь + запис гостя) «сервер» штампа не видає.
      if (!surfacePresence([req.eventId], req.at)[req.eventId]) return fail('forbidden', { reason: 'no-presence' });
      const stamp = grantStamp(req.eventId, req.source);
      return stamp ? ok(stamp) : fail('not_found', { reason: 'unknown-event' });
    },
    async beat() {
      // `sim` не шле пульсів — присутність рахує `trackPresence` на кожному такті.
      return fail('unavailable', { reason: 'sim-uses-trackPresence' });
    },
  };
}
