/**
 * Шлях автора для O-AUTHOR / PathMap (C13, FR-055): `ScriptAuthor.path` сценарію чату + розклад → точки на мапі.
 * Жодних відмінкових форм: міста й країни — у називному. Автор без пасу шляху не показує.
 */
import type { Author, ChatScriptFile, Dataset, Ms, Stamp } from '@/lib/data/types';
import { zoneRowOf } from '@/lib/firstrow/zone';

export interface PathPoint {
  /** `eventId` події. */
  id: string;
  city: string;
  country: string;
  flagCode: string;
  /** 0–1 у координатах повної мапи світу (`mapPoint`). */
  x: number;
  y: number;
  midnightMs: Ms;
  /** `true` — ще попереду (у графіку), порожня точка. */
  planned: boolean;
  /** Місто «Першого ряду» автора: подвійне кільце й підпис місця. */
  firstRowSeat?: number;
  /**
   * Мапа «Твій шлях» у «Моєму графіку» (варіант B «вузол і промені», рішення власника 2026-11-06): точка — промінь від
   * вузла свого поясу (`id` вузла). Лінія маршруту йде лише через вузли.
   */
  hubOf?: string;
  /** Пояс зараз в ефірі, штампа ще немає: червоне кільце «Зараз». */
  current?: boolean;
  /** Пояс події (`utc+0200`): вузол поясу на мапі шляху. */
  zoneId?: string;
  /** ISO країни події: зустрінута країна заливається золотом, як у паспорті й графіку. */
  countryIso?: string;
}

/**
 * Вузли поясів (варіант B «вузол і промені», як на «Моєму графіку» й у паспорті; картка автора — правка власника
 * 2026-11-09): кілька точок одного поясу — один вузол, решта — промені від нього (`hubOf`), лінія маршруту йде лише
 * через вузли. Вузол — перша зустрінута точка поясу в порядку вхідного масиву, а якщо зустрінутих немає — перша
 * запланована. Точки без `zoneId` лишаються окремими. Результат — у порядку північ, вузол перед своїми променями.
 */
export function assignZoneHubs(points: readonly PathPoint[]): PathPoint[] {
  const hubByZone = new Map<string, string>();
  for (const p of points) if (p.zoneId && !p.planned && !hubByZone.has(p.zoneId)) hubByZone.set(p.zoneId, p.id);
  for (const p of points) if (p.zoneId && !hubByZone.has(p.zoneId)) hubByZone.set(p.zoneId, p.id);
  return points
    .map((p): PathPoint => {
      const hub = p.zoneId ? hubByZone.get(p.zoneId) : undefined;
      const rest = { ...p };
      delete rest.hubOf;
      return hub && hub !== p.id ? { ...rest, hubOf: hub } : rest;
    })
    .sort((a, b) => a.midnightMs - b.midnightMs || Number(!!a.hubOf) - Number(!!b.hubOf));
}

/** Є пас: бейдж `pass`/`vip` або місце в «Першому ряду» (воно дарує пас). */
export function authorHasPass(author: Pick<Author, 'badges'>): boolean {
  return author.badges.some((b) => b === 'pass' || b === 'vip' || b === 'first-row');
}

/**
 * Точки шляху в порядку часу (за `midnightMs`); без пасу чи без шляху — порожньо. Якщо передано `now`, заплановані
 * точки, чия північ уже минула, відсіюються (як у `buildOwnPath`, рішення власника 2026-11-09); вузли поясів
 * перераховуються вже після відсіювання.
 */
export function buildAuthorPath(
  author: Pick<Author, 'id' | 'nick' | 'badges'>,
  script: ChatScriptFile,
  data: Dataset,
  now?: Ms,
): PathPoint[] {
  if (!authorHasPass(author)) return [];
  const scripted = script.authors.find((a) => a.id === author.id);
  if (!scripted?.path?.length) return [];
  const firstRow = author.badges.includes('first-row');
  const points: PathPoint[] = [];
  for (const step of scripted.path) {
    const event = data.eventsById.get(step.eventId);
    const city = event ? data.citiesById.get(event.cityId) : undefined;
    const country = event ? data.countriesByIso.get(event.countryIso) : undefined;
    if (!event || !city || !country) continue;
    if (now !== undefined && step.planned && event.midnightMs <= now) continue;
    // «Перший ряд» — один на пояс: місце автора — у ряду поясу цієї події.
    const rowId = zoneRowOf(data, event)?.id ?? step.eventId;
    const seed = script.firstRowSeed.find((s) => s.eventId === rowId);
    const seat = firstRow && !step.planned ? seed?.seats.find((s) => s.state === 'taken' && s.name?.startsWith(author.nick)) : undefined;
    points.push({
      id: event.id,
      city: city.name.uk,
      country: country.name.uk,
      flagCode: country.flagCode,
      x: city.mapPoint.x,
      y: city.mapPoint.y,
      midnightMs: event.midnightMs,
      planned: step.planned,
      zoneId: event.zoneId,
      countryIso: country.iso,
      ...(seat ? { firstRowSeat: seat.number } : {}),
    });
  }
  return assignZoneHubs(points);
}

/**
 * Власний шлях глядача (своє вікно в чаті): зустрінуті — зі штампів (з місцем «Першого ряду»), заплановані — події
 * з «Мого графіка», північ яких ще попереду й штампа ще немає. Показується завжди, з пасом чи без.
 */
export function buildOwnPath(stamps: readonly Stamp[], schedule: readonly string[], data: Dataset, now: Ms): PathPoint[] {
  const stamped = new Set(stamps.map((s) => s.eventId));
  const steps = [
    // Вузол поясу — основна трансляція (штамп не з кімнати), як на «Моєму графіку».
    ...[...stamps]
      .sort((a, b) => Number(a.presenceSource === 'room') - Number(b.presenceSource === 'room') || a.grantedAt - b.grantedAt)
      .map((s) => ({ eventId: s.eventId, planned: false, seat: s.firstRowSeat })),
    ...schedule.filter((id) => !stamped.has(id)).map((eventId) => ({ eventId, planned: true, seat: undefined })),
  ];
  const points: PathPoint[] = [];
  for (const step of steps) {
    const event = data.eventsById.get(step.eventId);
    const city = event ? data.citiesById.get(event.cityId) : undefined;
    const country = event ? data.countriesByIso.get(event.countryIso) : undefined;
    if (!event || !city || !country) continue;
    if (step.planned && event.midnightMs <= now) continue;
    points.push({
      id: event.id,
      city: city.name.uk,
      country: country.name.uk,
      flagCode: country.flagCode,
      x: city.mapPoint.x,
      y: city.mapPoint.y,
      midnightMs: event.midnightMs,
      planned: step.planned,
      zoneId: event.zoneId,
      countryIso: country.iso,
      ...(step.seat ? { firstRowSeat: step.seat } : {}),
    });
  }
  return assignZoneHubs(points);
}

/** Скільки різних країн серед зустрінутих і скільки точок ще попереду. */
export function pathSummary(points: readonly PathPoint[]): { met: number; planned: number } {
  const metCountries = new Set(points.filter((p) => !p.planned).map((p) => p.flagCode));
  return { met: metCountries.size, planned: points.filter((p) => p.planned).length };
}

/** Текстовий маршрут: «Окленд → Сідней → Дубай → Каїр»; довгий — перше, останнє й «+N». */
export function routeCities(points: readonly PathPoint[], limit = 5): { met: string[]; planned: string[] } {
  const met = points.filter((p) => !p.planned).map((p) => p.city);
  const planned = points.filter((p) => p.planned).map((p) => p.city);
  if (met.length <= limit) return { met, planned };
  return { met: [met[0]!, `+${met.length - 2}`, met[met.length - 1]!], planned };
}
