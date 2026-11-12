/**
 * Мапа «Твій шлях» на сторінці «Мій графік» (рішення власника 2026-11-06, варіант B «вузол і промені»):
 * - зустрінуті — зі штампів (золото); у поясі з кількома штампами (кімната перегляду) вузол — основна трансляція: штамп не
 *   з кімнати, а якщо всі з кімнати — найперший; решта — промені;
 * - у графіку — країни поясів, що ще попереду (біло-сірі); вузол — перша додана країна поясу, решта — промені;
 * - пояс зараз в ефірі без штампа — червоне кільце «Зараз».
 * Лінія маршруту йде через вузли в порядку півночей.
 */
import type { Dataset, Ms, Stamp } from '@/lib/data/types';
import type { PathPoint } from '@/lib/chat-sim/authorPath';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { zoneState } from '@/lib/engine/zoneState';
import { scheduledCountries } from './countryZone';

function point(data: Dataset, eventId: string, planned: boolean, extra: Partial<PathPoint> = {}): PathPoint | null {
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
    ...extra,
  };
}

export function buildSchedulePath(stamps: readonly Stamp[], schedule: readonly string[], data: Dataset, now: Ms): PathPoint[] {
  const out: PathPoint[] = [];
  const hubByZone = new Map<string, string>();
  // Зустрінуті: по поясах.
  const byZone = new Map<string, Stamp[]>();
  for (const st of stamps) {
    const z = data.eventsById.get(st.eventId)?.zoneId;
    if (!z) continue;
    byZone.set(z, [...(byZone.get(z) ?? []), st]);
  }
  for (const [zoneId, list] of byZone) {
    const sorted = [...list].sort((a, b) => a.grantedAt - b.grantedAt);
    const hub = sorted.find((s) => s.presenceSource !== 'room') ?? sorted[0]!;
    hubByZone.set(zoneId, hub.eventId);
    for (const st of sorted) {
      const p = point(data, st.eventId, false, st.eventId !== hub.eventId ? { hubOf: hub.eventId } : {});
      if (p) out.push(p);
    }
  }
  // У графіку: пояси, що ще не минули.
  const stampedCountry = new Set(stamps.map((s) => `${data.eventsById.get(s.eventId)?.zoneId}:${s.countryIso}`));
  for (const zone of data.zones) {
    if (now >= zone.midnightMs + HANDOVER_AFTER) continue;
    const isos = scheduledCountries(schedule, zone.id, data).filter((iso) => !stampedCountry.has(`${zone.id}:${iso}`));
    if (!isos.length) continue;
    const live = now > 0 && zoneState(now, zone, data.zones) === 'live';
    let hub = hubByZone.get(zone.id);
    for (const iso of isos) {
      const eventId = schedule.find((id) => {
        const e = data.eventsById.get(id);
        return e?.zoneId === zone.id && e.countryIso === iso;
      });
      if (!eventId) continue;
      const p = point(data, eventId, true, { ...(hub ? { hubOf: hub } : {}), ...(live && !hub ? { current: true } : {}) });
      if (!p) continue;
      out.push(p);
      hub ??= eventId;
    }
  }
  return out.sort((a, b) => a.midnightMs - b.midnightMs || Number(!!a.hubOf) - Number(!!b.hubOf));
}
