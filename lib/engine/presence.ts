/**
 * Присутність для штампа (`data-model.md` 1.10, 3.6; FR-060). Чисті функції: `now` — серверний час.
 *
 * Поверхня (`PresenceSurface`) — відкрита сторінка, що показує події: ефір (головна), сторінка країни,
 * вікно кімнати, ТВ. Правила:
 * - присутність фіксується в момент півночі події; поверхня, відкрита до півночі й не закрита до неї, — присутня;
 * - відкриття поверхні в межах `STAMP_DELAY` (15 с) після півночі теж зараховується (пільговий інтервал = затримка відео);
 * - якщо людина пішла між північчю й «+15 с», присутність уже зафіксована — штамп однаково нараховується;
 * - пауза відео не має значення (стану плеєра тут немає взагалі);
 * - штамп один на подію (ключ `eventId`), `grantedAt = midnightUtc + 15 с`, а не момент перегляду.
 */
import type { City, Country, Event, Ms, PresenceSource, Stamp } from '@/lib/data/types';
import { STAMP_DELAY } from './config';
import { midnightOf } from './eventStatus';

export interface PresenceSurface {
  source: PresenceSource;
  /** Події, які поверхня показує (ефір — одна; кімната — за кожне вікно). */
  eventIds: readonly string[];
  /** Коли поверхня почала показувати ці події (серверний час). */
  openedAt: Ms;
  /** Коли поверхню закрито; `undefined` — ще відкрита. */
  closedAt?: Ms;
}

type EventLike = Pick<Event, 'id' | 'midnightUtc'> & { midnightMs?: Ms };

/**
 * Чи присутня поверхня на події в момент `now`: `source` або `null`.
 * `null` до півночі (присутність ще не настала), якщо поверхня не показує подію,
 * відкрита пізніше ніж через 15 с після півночі або закрита до півночі.
 */
export function presenceOf(surface: PresenceSurface, now: Ms, event: EventLike): PresenceSource | null {
  if (!surface.eventIds.includes(event.id)) return null;
  const t0 = midnightOf(event);
  if (now < t0) return null;
  if (surface.openedAt > t0 + STAMP_DELAY) return null;
  if (surface.closedAt !== undefined && surface.closedAt < t0) return null;
  // Відкрита після півночі (у пільговому інтервалі) — присутня лише з моменту відкриття.
  if (surface.openedAt > now) return null;
  return surface.source;
}

/** Момент, яким позначається присутність: північ або (у пільговому інтервалі) відкриття поверхні. */
export function presenceMoment(surface: PresenceSurface, event: EventLike): Ms {
  return Math.max(midnightOf(event), surface.openedAt);
}

/** Пріоритет джерела, коли подію показують кілька поверхонь одночасно. */
const PRIORITY: Record<PresenceSource, number> = { country: 4, room: 3, air: 2, tv: 1 };

/**
 * Присутність за подіями з кількох поверхонь у момент `at` (для `EngineScheduler.getPresence`).
 * `events` — подія за id (лише ті, що передано, перевіряються).
 */
export function presentEvents(
  surfaces: readonly PresenceSurface[],
  events: readonly EventLike[],
  at: Ms,
): Record<string, PresenceSource> {
  const out: Record<string, PresenceSource> = {};
  for (const event of events) {
    for (const s of surfaces) {
      const src = presenceOf(s, at, event);
      if (src && (!out[event.id] || PRIORITY[src] > PRIORITY[out[event.id]!])) out[event.id] = src;
    }
  }
  return out;
}

export interface StampContext {
  event: EventLike & Pick<Event, 'countryIso' | 'cityId'>;
  country: Pick<Country, 'illustrationId'> | undefined;
  city: Pick<City, 'name'> | undefined;
  presenceSource: PresenceSource;
}

/** Штамп за подію: `grantedAt` — північ + 15 с серверного часу. */
export function buildStamp(ctx: StampContext): Stamp {
  return {
    eventId: ctx.event.id,
    grantedAt: midnightOf(ctx.event) + STAMP_DELAY,
    presenceSource: ctx.presenceSource,
    illustrationId: ctx.country?.illustrationId ?? 'generic',
    cityName: ctx.city?.name.uk ?? '',
    countryIso: ctx.event.countryIso,
  };
}
