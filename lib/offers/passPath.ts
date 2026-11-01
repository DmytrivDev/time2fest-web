/**
 * Дані пропозиції пасу «Наступна північ» (дошка `Desk-PassOffer-Next`, рішення власника 2026-11-01):
 * зустрінуті гостем півночі (за штампами, від ранніх до пізніх) і найближчі півночі після «зараз» —
 * по одній події на момент (найпопулярніша), з часом за поясом глядача.
 */
import { getData } from '@/lib/data/load';
import type { Ms, Stamp } from '@/lib/data/types';

export interface PathPoint {
  eventId: string;
  flagCode: string;
  /** Місто (як у розкладі) — для підпису й зчитувача. */
  city: string;
  midnightMs: Ms;
}

export function metPoints(stamps: readonly Stamp[]): PathPoint[] {
  const data = getData();
  const out: PathPoint[] = [];
  for (const s of stamps) {
    const e = data.eventsById.get(s.eventId);
    if (!e) continue;
    const country = data.countriesByIso.get(e.countryIso);
    out.push({ eventId: e.id, flagCode: country?.flagCode ?? e.countryIso, city: data.citiesById.get(e.cityId)?.name.uk ?? s.cityName, midnightMs: e.midnightMs });
  }
  return out.sort((a, b) => a.midnightMs - b.midnightMs);
}

/** Найближчі `limit` півночей після `now`: на кожен момент — найпопулярніша подія. */
export function nextPoints(now: Ms, limit = 3): PathPoint[] {
  const data = getData();
  const bySlot = new Map<Ms, (typeof data.events)[number]>();
  for (const e of data.events) {
    if (e.midnightMs <= now) continue;
    const cur = bySlot.get(e.midnightMs);
    if (!cur || e.popularity > cur.popularity) bySlot.set(e.midnightMs, e);
  }
  return [...bySlot.values()]
    .sort((a, b) => a.midnightMs - b.midnightMs)
    .slice(0, limit)
    .map((e) => ({
      eventId: e.id,
      flagCode: data.countriesByIso.get(e.countryIso)?.flagCode ?? e.countryIso,
      city: data.citiesById.get(e.cityId)?.name.uk ?? '',
      midnightMs: e.midnightMs,
    }));
}

/** Скільки Нових років ще попереду цієї ночі (моментів після `now`). */
export function remainingMidnights(now: Ms): number {
  return new Set(getData().events.filter((e) => e.midnightMs > now).map((e) => e.midnightMs)).size;
}
