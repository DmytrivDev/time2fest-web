/**
 * Чисті помічники сторінки країни (S-COUNTRY): місце ефіру з події, ланцюжок події для плеєра, «наступна подія» після
 * півночі, пояс для вибору в шапці, пояс/подія з адреси (`?e=` / `?zone=` / `?s=`). Без React; виокремлено з
 * `CountryLive.tsx` (WP-F).
 */
import type { CountryZoneOption } from '@/components/live/CountryHeader';
import type { Dataset, LoadedZone, Ms, ScheduledEvent } from '@/lib/data/types';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { isReducedMotionNow } from '@/lib/a11y/reducedMotion';
import { countryMainEvent, countryStreamRows } from '@/lib/live/countryData';
import { countryHref, type AirPlace } from '@/lib/player/BroadcastController';
import type { PlayerChainInput } from '@/lib/player/PlayerProvider';
import { utcLabel } from './MapModel';

export function placeOf(data: Dataset, event: ScheduledEvent | undefined | null): AirPlace | null {
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  return {
    event,
    city: data.citiesById.get(event.cityId),
    country,
    href: country ? countryHref(country) : null,
  };
}

/**
 * Ланцюжок події для плеєра. Без обраної людиною трансляції — головне святкування (`kind: 'main'`), якщо воно є: ще не
 * почалось — на місці відео заглушка «Очікуйте трансляцію» (правка власника 2026-11-11), а не перша-ліпша вебкамера; і коли
 * час початку невідомий чи вже минув (2026-11-13). Обрана людиною трансляція, що «очікується» без часу початку, — теж заглушка.
 */
export function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  const preferred = preferredSourceId ?? sources.find((s) => s.kind === 'main')?.id;
  if (!preferred) return { eventId, sources };
  const wait = !preferredSourceId || sources.find((s) => s.id === preferred)?.status === 'expected';
  return wait ? { eventId, sources, preferredSourceId: preferred, waitForPreferred: true } : { eventId, sources, preferredSourceId: preferred };
}

/** Угору до плеєра (вибір трансляції в списку під ним). */
export function scrollToPlayer() {
  window.scrollTo({ top: 0, behavior: isReducedMotionNow() ? 'auto' : 'smooth' });
}

/** Наступна подія розкладу після півночі `event` (для «· далі: …» у пульті): подія наступного слота ефіру. */
export function nextAfter(data: Dataset, event: ScheduledEvent, now: Ms): ScheduledEvent | null {
  const slot = airSlots(data).find((s) => s.midnightMs > event.midnightMs);
  return slot
    ? (pickSlotEvent(now, slot.events, data.countriesByIso, data.chainsByEventId)?.event ?? null)
    : null;
}

/** Пояс країни для вибору в шапці: місто головної події, «UTC−5», північ і скільки трансляцій. */
export function zoneOption(
  data: Dataset,
  iso: string,
  zone: LoadedZone,
  now: Ms,
  streamsNote: (n: number) => string,
): CountryZoneOption {
  const city = data.citiesById.get(countryMainEvent(data, iso, zone.id)?.cityId ?? '');
  const n = countryStreamRows(data, iso, zone.id, now).length;
  return {
    id: zone.id,
    utc: utcLabel(zone.offsetMinutes),
    city: city?.name.uk ?? '',
    midnightMs: zone.midnightMs,
    note: streamsNote(n),
  };
}

/** Що відкрити на сторінці країни з адреси (`?e=` подія / `?zone=` пояс, `countryHref`): пояс і, можливо, подія. */
export interface CountryFocus {
  zoneId: string;
  eventId: string | null;
  /** Обрана трансляція події (`?s=`). */
  sourceId?: string | null;
}

export function countryFocusFrom(
  data: Dataset,
  iso: string,
  zoneIds: readonly string[],
  e: string | null,
  zone: string | null,
  s: string | null = null,
): CountryFocus | null {
  const ev = e ? data.eventsById.get(e) : undefined;
  if (ev && ev.countryIso === iso && zoneIds.includes(ev.zoneId)) {
    const src = s ? data.chainsByEventId.get(ev.id)?.sources.find((x) => x.id === s) : undefined;
    return { zoneId: ev.zoneId, eventId: ev.id, ...(src ? { sourceId: src.id } : {}) };
  }
  if (zone && zoneIds.includes(zone)) return { zoneId: zone, eventId: null };
  return null;
}
