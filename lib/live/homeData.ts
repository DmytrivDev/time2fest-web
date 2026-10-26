/**
 * Дані блоків головної з набору даних області (чисті функції, «зараз» — аргументом від `TimeSource`):
 * картки «Зараз і далі», прогрес свята, країни поясу, основні святкування, рядок графіка (FR-014).
 */
import type { CountryChipItem } from '@/components/live/CountryChips';
import type { EventCardData, EventCardStream } from '@/components/live/EventCard';
import type { FestProgressProps } from '@/components/live/Progress';
import type { Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { chainStatus } from '@/lib/engine/sourceStatus';
import { countryHref } from '@/lib/player/BroadcastController';

const HOUR = 3_600_000;

function streamOf(data: Dataset, event: ScheduledEvent, now: Ms): EventCardStream {
  const st = chainStatus(data.chainsByEventId.get(event.id), now);
  return st === 'none' ? 'countdown-only' : st;
}

/** Чи північ події збігається з північчю глядача (той самий зсув від UTC у момент півночі). */
function isOwnMidnight(data: Dataset, event: ScheduledEvent): boolean {
  const zone = data.zonesById.get(event.zoneId);
  if (!zone) return false;
  // Лише зсув поясу браузера в момент півночі (не «зараз» пристрою).
  return -new Date(event.midnightMs).getTimezoneOffset() === zone.offsetMinutes;
}

export function eventCard(data: Dataset, event: ScheduledEvent, now: Ms, schedule: readonly string[]): EventCardData {
  const country = data.countriesByIso.get(event.countryIso);
  const city = data.citiesById.get(event.cityId);
  return {
    id: event.id,
    title: city?.name.uk ?? event.id,
    countryName: country?.name.uk,
    flagCode: country?.flagCode ?? event.countryIso,
    midnightMs: event.midnightMs,
    celebrationType: event.type,
    stream: streamOf(data, event, now),
    href: country ? countryHref(country) : '/',
    inSchedule: schedule.includes(event.id),
    isOwnMidnight: isOwnMidnight(data, event),
  };
}

/** «Зараз і далі»: подія кожного слота ефіру (та сама, що бере ефір). */
export function nowNextItems(data: Dataset, now: Ms, schedule: readonly string[]): EventCardData[] {
  const out: EventCardData[] = [];
  for (const slot of airSlots(data)) {
    const pick = pickSlotEvent(now, slot.events, data.countriesByIso, data.chainsByEventId);
    if (pick) out.push(eventCard(data, pick.event, now, schedule));
  }
  return out;
}

/** «Минуло 13 год із 26 · Новий рік зустріли 23 пояси з 38». */
export function festProgress(data: Dataset, now: Ms): FestProgressProps {
  const zones = data.zones;
  const first = zones[0]?.midnightMs ?? now;
  const last = zones[zones.length - 1]?.midnightMs ?? now;
  const hoursTotal = Math.round((last - first) / HOUR);
  const hoursPassed = Math.min(hoursTotal, Math.max(0, Math.floor((now - first) / HOUR)));
  return {
    hoursPassed,
    hoursTotal,
    zonesDone: zones.filter((z) => z.midnightMs <= now).length,
    zonesTotal: zones.length,
  };
}

/** Країни поясу події (чипи під плеєром). */
export function zoneCountries(data: Dataset, zoneId: string): CountryChipItem[] {
  return data.countries
    .filter((c) => c.zoneIds.includes(zoneId))
    .sort((a, b) => b.popularity - a.popularity)
    .map((c) => ({ iso: c.iso, name: c.name.uk, flagCode: c.flagCode }));
}

/** Основні святкування: головні події з трансляцією або вебкамерою, найпопулярніші. */
export function mainCelebrations(data: Dataset, now: Ms, schedule: readonly string[], limit = 16): EventCardData[] {
  return data.events
    .filter((e) => e.isMainCelebration && e.type !== 'countdown-only')
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit)
    .map((e) => eventCard(data, e, now, schedule));
}

/**
 * FR-014: подія з графіка гостя, у якої північ у тому самому слоті ефіру, що й поточна, але в плеєрі не вона.
 * `null` — графік порожній або в ньому немає нічого «зараз».
 */
export function scheduleNow(
  data: Dataset,
  schedule: readonly string[],
  current: Pick<ScheduledEvent, 'id' | 'midnightMs'> | null,
): { place: string; href: string } | null {
  if (!current || schedule.length === 0) return null;
  for (const id of schedule) {
    if (id === current.id) continue;
    const event = data.eventsById.get(id);
    if (!event || event.midnightMs !== current.midnightMs) continue;
    const country = data.countriesByIso.get(event.countryIso);
    const city = data.citiesById.get(event.cityId);
    if (!country || !city) continue;
    return { place: city.name.uk, href: countryHref(country) };
  }
  return null;
}
