/**
 * Шлях автора для O-AUTHOR / PathMap (C13, FR-055): `ScriptAuthor.path` сценарію чату + розклад → точки на мапі.
 * Жодних відмінкових форм: міста й країни — у називному. Автор без пасу шляху не показує.
 */
import type { Author, ChatScriptFile, Dataset, Ms } from '@/lib/data/types';

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
}

/** Є пас: бейдж `pass`/`vip` або місце в «Першому ряду» (воно дарує пас). */
export function authorHasPass(author: Pick<Author, 'badges'>): boolean {
  return author.badges.some((b) => b === 'pass' || b === 'vip' || b === 'first-row');
}

/** Точки шляху в порядку часу (за `midnightMs`); без пасу чи без шляху — порожньо. */
export function buildAuthorPath(author: Pick<Author, 'id' | 'nick' | 'badges'>, script: ChatScriptFile, data: Dataset): PathPoint[] {
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
    const seed = script.firstRowSeed.find((s) => s.eventId === step.eventId);
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
      ...(seat ? { firstRowSeat: seat.number } : {}),
    });
  }
  return points.sort((a, b) => a.midnightMs - b.midnightMs);
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
