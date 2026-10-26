import type {
  CountriesFile,
  Country,
  Gender,
  ScheduledEvent,
  ScheduleFile,
  StreamSource,
  StreamsFile,
} from '@/lib/data/types';

export const MIN = 60_000;
export const SEC = 1_000;

/** Північ Лондона 2027 (UTC+0). */
export const LONDON_MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
/** Північ Парижа/Берліна (UTC+1). */
export const PARIS_MIDNIGHT = Date.parse('2026-12-31T23:00:00Z');
/** Північ Ріо (UTC−3). */
export const RIO_MIDNIGHT = Date.parse('2027-01-01T03:00:00Z');

export function country(iso: string, opts: Partial<Country> = {}): Country {
  return {
    iso,
    slug: iso.toLowerCase(),
    name: { uk: iso },
    gender: 'f' as Gender,
    flagCode: iso,
    zoneIds: [],
    illustrationId: `${iso.toLowerCase()}-postcard`,
    howTo: { traditions: [], text: '' },
    popularity: 50,
    ...opts,
  };
}

export function event(
  id: string,
  midnightMs: number,
  opts: Partial<ScheduledEvent> = {},
): ScheduledEvent {
  return {
    id: `evt_${id}_2027`,
    cityId: id,
    zoneId: 'utc+0000',
    countryIso: 'GB',
    midnightUtc: new Date(midnightMs).toISOString(),
    isMainCelebration: true,
    type: 'main',
    popularity: 50,
    midnightMs,
    ...opts,
  };
}

export function source(id: string, opts: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    platform: 'youtube',
    videoId: 'AbCdEfGhIjK',
    url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
    kind: 'main',
    title: { uk: id },
    order: 0,
    status: 'live',
    embeddable: true,
    lastChecked: '2026-10-26T10:00:00Z',
    verified: false,
    isLive: true,
    ...opts,
  };
}

/** Невеликий розклад: Париж (FR, DE), Лондон (GB, PT), Ріо (BR). */
export function miniSchedule(): { schedule: ScheduleFile; countries: CountriesFile; streams: StreamsFile } {
  const zone = (id: string, order: number, offsetMinutes: number, ms: number, rep: string) => ({
    id,
    order,
    offsetMinutes,
    midnightUtc: new Date(ms).toISOString().replace('.000Z', 'Z'),
    representativeCityId: rep,
  });
  const ev = (cityId: string, ms: number, main: boolean, pop: number, firstRow = main) => ({
    id: `evt_${cityId}_2027`,
    midnightUtc: new Date(ms).toISOString().replace('.000Z', 'Z'),
    isMainCelebration: main,
    type: 'main' as const,
    popularity: pop,
    ...(firstRow ? { firstRow: { saleEnabled: true } } : {}),
  });
  const city = (id: string, ms: number, main = true, pop = 50) => ({
    id,
    name: { uk: id },
    celebrationType: 'main' as const,
    isCountryMain: main,
    mapPoint: { x: 0.5, y: 0.5 },
    events: [ev(id, ms, main, pop)],
  });
  const schedule: ScheduleFile = {
    version: 1,
    season: '2026-27',
    generatedAt: '2026-10-26T09:00:00Z',
    tzdbVersion: '2026e',
    zones: [
      // навмисно не за порядком — buildDataset сортує
      {
        ...zone('utc+0000', 1, 0, LONDON_MIDNIGHT, 'london'),
        countries: [
          { iso: 'GB', cities: [city('london', LONDON_MIDNIGHT, true, 95), city('manchester', LONDON_MIDNIGHT, false, 40)] },
          { iso: 'PT', cities: [city('lisbon', LONDON_MIDNIGHT, true, 60)] },
        ],
      },
      {
        ...zone('utc+0100', 0, 60, PARIS_MIDNIGHT, 'paris'),
        countries: [
          { iso: 'FR', cities: [city('paris', PARIS_MIDNIGHT, true, 90)] },
          { iso: 'DE', cities: [city('berlin', PARIS_MIDNIGHT, true, 80)] },
        ],
      },
      {
        ...zone('utc-0300', 2, -180, RIO_MIDNIGHT, 'rio'),
        countries: [{ iso: 'BR', cities: [city('rio', RIO_MIDNIGHT, true, 85)] }],
      },
    ],
  };
  const countries: CountriesFile = {
    version: 1,
    countries: [
      country('GB', { slug: 'velyka-brytaniia', name: { uk: 'Велика Британія' }, popularity: 90, zoneIds: ['utc+0000'] }),
      country('PT', { slug: 'portuhaliia', name: { uk: 'Португалія' }, popularity: 60, zoneIds: ['utc+0000'] }),
      country('FR', { slug: 'frantsiia', name: { uk: 'Франція' }, popularity: 88, zoneIds: ['utc+0100'] }),
      country('DE', { slug: 'nimechchyna', name: { uk: 'Німеччина' }, popularity: 85, zoneIds: ['utc+0100'] }),
      country('BR', { slug: 'braziliia', name: { uk: 'Бразилія' }, popularity: 80, zoneIds: ['utc-0300'] }),
    ],
  };
  const streams: StreamsFile = {
    version: 1,
    season: '2026-27',
    generatedAt: '2026-10-26T10:00:00Z',
    lastCheckedAt: null,
    chains: [
      {
        eventId: 'evt_london_2027',
        sources: [source('src_london_2', { order: 1 }), source('src_london_1', { order: 0 })],
      },
    ],
  };
  return { schedule, countries, streams };
}
