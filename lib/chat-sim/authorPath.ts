/**
 * Шлях автора для O-AUTHOR / PathMap (C13, FR-055): `ScriptAuthor.path` сценарію чату + розклад → точки на мапі.
 * Жодних відмінкових форм: міста й країни — у називному. Автор без пасу шляху не показує.
 */
import type { Author, ChatScriptFile, Dataset, Ms, Stamp } from '@/lib/data/types';
import { currentZoneRow, zoneRowOf, zoneRows } from '@/lib/firstrow/zone';

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

/** Ряд «Першого ряду», де сидить учасник: подія-носій ряду й номер місця. */
export interface ParticipantRow {
  eventId: string;
  seat?: number;
}

/** Ім’я на стіні належить ніку: «Олена» ↔ «Олена і друзі». */
const nameOf = (name: string | undefined, nick: string) => !!name && (name === nick || name.startsWith(`${nick} `) || nick.startsWith(`${name} `));

/**
 * Ряд учасника за імітацією місць (`firstRowSeed`): ряд поточного поясу, якщо він там сидить, інакше останній ряд,
 * чия північ уже минула, інакше перший. Не сидить ніде — `null`.
 */
export function seededRow(nick: string, script: ChatScriptFile, data: Dataset, now?: Ms): ParticipantRow | null {
  const found = script.firstRowSeed
    .map((entry) => {
      const seat = entry.seats.find((s) => s.state === 'taken' && nameOf(s.name, nick));
      const event = data.eventsById.get(entry.eventId);
      return seat && event ? { eventId: entry.eventId, seat: seat.number, midnightMs: event.midnightMs } : null;
    })
    .filter((x): x is { eventId: string; seat: number; midnightMs: Ms } => !!x)
    .sort((a, b) => a.midnightMs - b.midnightMs);
  if (!found.length) return null;
  const current = now !== undefined ? currentZoneRow(data, now) : null;
  const pick =
    found.find((f) => f.eventId === current?.id) ??
    (now !== undefined ? [...found].reverse().find((f) => f.midnightMs <= now) : undefined) ??
    found[0]!;
  return { eventId: pick.eventId, seat: pick.seat };
}

/** Детермінований генератор від рядка (FNV-1a + xorshift): той самий учасник — той самий шлях. */
function rng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 0x100000000;
  };
}

function pointOf(data: Dataset, eventId: string, planned: boolean, seat?: number): PathPoint | null {
  const event = data.eventsById.get(eventId);
  const city = event ? data.citiesById.get(event.cityId) : undefined;
  const country = event ? data.countriesByIso.get(event.countryIso) : undefined;
  if (!event || !city || !country) return null;
  return {
    id: event.id,
    city: city.name.uk,
    country: country.name.uk,
    flagCode: country.flagCode,
    x: city.mapPoint.x,
    y: city.mapPoint.y,
    midnightMs: event.midnightMs,
    planned,
    zoneId: event.zoneId,
    countryIso: country.iso,
    ...(seat && !planned ? { firstRowSeat: seat } : {}),
  };
}

/**
 * Згенерований шлях учасника «Першого ряду», для якого в сценарії шляху немає (правка власника 2026-11-10: кожен
 * учасник бігучого рядка відкриває свою картку зі шляхом). Ряд, де він сидить (з місцем), 1–3 ряди поясів раніше й
 * інколи один пізніше; минула північ — зустрінуто, ще попереду — у графіку. Детермінований від `seed` (id чи ім’я).
 */
export function generatedPath(seed: string, row: ParticipantRow, data: Dataset, now?: Ms): PathPoint[] {
  const event = data.eventsById.get(row.eventId);
  if (!event) return [];
  const rows = zoneRows(data);
  const carrier = zoneRowOf(data, event) ?? event;
  const at = rows.findIndex((r) => r.id === carrier.id);
  const rand = rng(seed);
  const earlier = at > 0 ? rows.slice(Math.max(0, at - 7), at) : [];
  const picks = new Set<string>();
  const want = Math.min(earlier.length, 1 + Math.floor(rand() * 3));
  while (picks.size < want) picks.add(earlier[Math.floor(rand() * earlier.length)]!.id);
  const later = at >= 0 ? rows.slice(at + 1, at + 5) : [];
  if (later.length && rand() < 0.5) picks.add(later[Math.floor(rand() * later.length)]!.id);
  const past = (id: string) => now === undefined || (data.eventsById.get(id)?.midnightMs ?? Infinity) <= now;
  const points = [...picks, event.id]
    .map((id) => pointOf(data, id, !past(id), id === event.id ? row.seat : undefined))
    .filter((p): p is PathPoint => !!p);
  return assignZoneHubs(points);
}

/**
 * Точки шляху в порядку часу (за `midnightMs`); без пасу — порожньо. Якщо передано `now`, заплановані
 * точки, чия північ уже минула, відсіюються (як у `buildOwnPath`, рішення власника 2026-11-09); вузли поясів
 * перераховуються вже після відсіювання. Шляху в сценарії немає, але автор сидить у «Першому ряду» (`row` або
 * імітація місць) — згенерований шлях (`generatedPath`, 2026-11-10); інакше порожньо («зустрічей ще нема»).
 */
export function buildAuthorPath(
  author: Pick<Author, 'id' | 'nick' | 'badges'>,
  script: ChatScriptFile,
  data: Dataset,
  now?: Ms,
  row?: ParticipantRow,
): PathPoint[] {
  if (!authorHasPass(author)) return [];
  const scripted = script.authors.find((a) => a.id === author.id);
  if (!scripted?.path?.length) {
    const seat = row ?? seededRow(author.nick, script, data, now);
    return seat ? generatedPath(author.id, seat, data, now) : [];
  }
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
