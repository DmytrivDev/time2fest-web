/**
 * Побудова штампа за подію (`data-model.md` 1.10). Правила часу штампа — у `@time2fest/rules/time`
 * (`stampGrantedAt`); тут лише збірка запису з даних сайту.
 */
import type { City, Country, Event, Ms, PresenceSource, Stamp } from '@/lib/data/types';
import { midnightOf, stampGrantedAt } from '@time2fest/rules/time';

export interface StampContext {
  event: Pick<Event, 'id' | 'midnightUtc' | 'countryIso' | 'cityId'> & { midnightMs?: Ms };
  country: Pick<Country, 'illustrationId'> | undefined;
  city: Pick<City, 'name'> | undefined;
  presenceSource: PresenceSource;
}

/** Штамп за подію: `grantedAt` — північ + 15 с серверного часу. */
export function buildStamp(ctx: StampContext): Stamp {
  return {
    eventId: ctx.event.id,
    grantedAt: stampGrantedAt(midnightOf(ctx.event)),
    presenceSource: ctx.presenceSource,
    illustrationId: ctx.country?.illustrationId ?? 'generic',
    cityName: ctx.city?.name.uk ?? '',
    countryIso: ctx.event.countryIso,
  };
}
