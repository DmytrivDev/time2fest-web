import type {
  City,
  CountriesFile,
  Country,
  Dataset,
  LoadedZone,
  ScheduleFile,
  ScheduledEvent,
  SlotGroup,
  StreamChain,
  StreamsFile,
} from './types';

/**
 * Будує індекси з трьох статичних файлів. Чиста функція: `Date.parse` викликається
 * один раз на пояс і подію. Ланцюжки джерел сортуються за `order`.
 */
export function buildDataset(
  schedule: ScheduleFile,
  countriesFile: CountriesFile,
  streams: StreamsFile | null,
): Dataset {
  const zones: LoadedZone[] = [];
  const cities: City[] = [];
  const events: ScheduledEvent[] = [];

  for (const z of schedule.zones) {
    const midnightMs = Date.parse(z.midnightUtc);
    if (Number.isNaN(midnightMs)) throw new Error(`schedule: invalid midnightUtc in ${z.id}`);
    zones.push({
      id: z.id,
      order: z.order,
      offsetMinutes: z.offsetMinutes,
      midnightUtc: z.midnightUtc,
      representativeCityId: z.representativeCityId,
      midnightMs,
    });
    for (const c of z.countries) {
      for (const city of c.cities) {
        cities.push({
          id: city.id,
          countryIso: c.iso,
          zoneId: z.id,
          name: city.name,
          ...(city.landmark ? { landmark: city.landmark } : {}),
          celebrationType: city.celebrationType,
          mapPoint: city.mapPoint,
          isCountryMain: city.isCountryMain,
        });
        for (const e of city.events) {
          const eventMs = e.midnightUtc === z.midnightUtc ? midnightMs : Date.parse(e.midnightUtc);
          events.push({
            id: e.id,
            cityId: city.id,
            zoneId: z.id,
            countryIso: c.iso,
            midnightUtc: e.midnightUtc,
            isMainCelebration: e.isMainCelebration,
            type: e.type,
            popularity: e.popularity,
            ...(e.restrained ? { restrained: e.restrained } : {}),
            ...(e.firstRow ? { firstRow: e.firstRow } : {}),
            midnightMs: eventMs,
          });
        }
      }
    }
  }

  zones.sort((a, b) => a.midnightMs - b.midnightMs);

  // «Перший ряд» — у кожному поясі (власник 2026-11-06): пояс, де в розкладі немає жодної події з «Першим рядом»
  // (здебільшого — без трансляцій), отримує ряд на головному святкуванні поясу (далі — найпопулярнішому). Чужих місць
  // для нього в імітації немає — ряд порожній, і це пропозиція стати першим.
  const withRow = new Set(events.filter((e) => e.firstRow?.saleEnabled).map((e) => e.zoneId));
  const carrier = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (withRow.has(e.zoneId)) continue;
    const cur = carrier.get(e.zoneId);
    const better =
      !cur ||
      (e.isMainCelebration !== cur.isMainCelebration
        ? e.isMainCelebration
        : (e.popularity ?? 0) > (cur.popularity ?? 0));
    if (better) carrier.set(e.zoneId, e);
  }
  for (const e of carrier.values()) e.firstRow = { saleEnabled: true };

  const bySlot = new Map<number, SlotGroup>();
  for (const e of events) {
    let g = bySlot.get(e.midnightMs);
    if (!g) {
      g = { midnightMs: e.midnightMs, midnightUtc: e.midnightUtc, zoneId: e.zoneId, events: [] };
      bySlot.set(e.midnightMs, g);
    }
    g.events.push(e);
  }
  const eventsBySlot = [...bySlot.values()].sort((a, b) => a.midnightMs - b.midnightMs);

  const countries = countriesFile.countries;
  const chainsByEventId = new Map<string, StreamChain>();
  for (const chain of streams?.chains ?? []) {
    chainsByEventId.set(chain.eventId, {
      eventId: chain.eventId,
      sources: [...chain.sources].sort((a, b) => a.order - b.order),
    });
  }

  return {
    meta: {
      season: schedule.season,
      generatedAt: schedule.generatedAt,
      tzdbVersion: schedule.tzdbVersion,
    },
    zones,
    zonesById: indexBy(zones, (z) => z.id),
    countries,
    countriesByIso: indexBy(countries, (c: Country) => c.iso),
    countriesBySlug: indexBy(countries, (c: Country) => c.slug),
    cities,
    citiesById: indexBy(cities, (c) => c.id),
    events,
    eventsById: indexBy(events, (e) => e.id),
    eventsBySlot,
    chainsByEventId,
  };
}

function indexBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(key(it), it);
  return m;
}
