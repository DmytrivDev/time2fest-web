/**
 * Графік — це країни (рішення власника 2026-11-04, дошка `Desk-Schedule-Countries`): один запис = країна в її поясі.
 * Кілька подій тієї самої країни в тому самому поясі (Сідней і Мельбурн, Лос-Анджелес і Лас-Вегас) додаються й прибираються
 * разом: додали одну — у графіку всі, тож календарик на будь-якій із них (і на картці країни) показує один стан.
 *
 * Слоти поясу (рішення власника 2026-11-06, концепція `schedule-concept-2026-11-06.md`): у поясі до 4 країн — стільки
 * слотів, скільки країн у поясі, але не більше 4. П’ята країна не додається — вікно «Замінити в графіку?».
 * Порядок країн поясу — порядок додавання (перша додана — «вузол» на мапі шляху).
 */
import { getData } from '@/lib/data/load';
import type { Dataset } from '@/lib/data/types';

/** Скільки країн поясу можна мати в графіку щонайбільше. */
export const ZONE_SLOT_LIMIT = 4;

/** Усі події країни в поясі цієї події (сама подія — теж); невідома подія — лише вона. */
export function countryZoneEvents(eventId: string, data: Dataset = getData()): string[] {
  const e = data.eventsById.get(eventId);
  if (!e) return [eventId];
  return data.events.filter((x) => x.zoneId === e.zoneId && x.countryIso === e.countryIso).map((x) => x.id);
}

/** Країни поясу (за містами поясу, як у списку «Країни й міста»). */
export function zoneCountryIsos(zoneId: string, data: Dataset = getData()): string[] {
  return [...new Set(data.cities.filter((c) => c.zoneId === zoneId).map((c) => c.countryIso))];
}

/** Скільки слотів у поясі: стільки, скільки країн, але не більше 4. */
export function zoneSlotCount(zoneId: string, data: Dataset = getData()): number {
  return Math.min(ZONE_SLOT_LIMIT, zoneCountryIsos(zoneId, data).length);
}

/** Країни поясу в графіку — у порядку додавання (за першою подією країни в масиві графіка). */
export function scheduledCountries(schedule: readonly string[], zoneId: string, data: Dataset = getData()): string[] {
  const out: string[] = [];
  for (const id of schedule) {
    const e = data.eventsById.get(id);
    if (e && e.zoneId === zoneId && !out.includes(e.countryIso)) out.push(e.countryIso);
  }
  return out;
}

export type ScheduleToggle = 'added' | 'removed' | 'full';

/** Що станеться після натиску календарика: прибрати, додати чи пояс уже повний (тоді графік не змінюється). */
export function scheduleToggleResult(schedule: readonly string[], eventId: string, data: Dataset = getData()): ScheduleToggle {
  const group = countryZoneEvents(eventId, data);
  if (group.some((id) => schedule.includes(id))) return 'removed';
  const e = data.eventsById.get(eventId);
  if (!e) return 'added';
  return scheduledCountries(schedule, e.zoneId, data).length >= zoneSlotCount(e.zoneId, data) ? 'full' : 'added';
}

/** Новий графік після натискання календарика: був хоч один запис країни в поясі — прибрати всі, інакше — додати всі
 *  (якщо в поясі є вільний слот; повний пояс — без змін). */
export function toggleCountryZone(schedule: readonly string[], eventId: string, data: Dataset = getData()): string[] {
  const group = countryZoneEvents(eventId, data);
  const result = scheduleToggleResult(schedule, eventId, data);
  if (result === 'removed') return schedule.filter((id) => !group.includes(id));
  if (result === 'full') return [...schedule];
  return [...new Set([...schedule, ...group])];
}

/** Замінити країну `outIso` у поясі події `eventId` на країну цієї події — на тому самому місці (слоті). */
export function replaceCountryZone(schedule: readonly string[], outIso: string, eventId: string, data: Dataset = getData()): string[] {
  const e = data.eventsById.get(eventId);
  if (!e) return [...schedule];
  const out = new Set(data.events.filter((x) => x.zoneId === e.zoneId && x.countryIso === outIso).map((x) => x.id));
  const group = countryZoneEvents(eventId, data).filter((id) => !schedule.includes(id));
  const at = schedule.findIndex((id) => out.has(id));
  const kept = schedule.filter((id) => !out.has(id));
  if (at < 0) return [...new Set([...kept, ...group])];
  const pos = schedule.slice(0, at).filter((id) => !out.has(id)).length;
  return [...kept.slice(0, pos), ...group, ...kept.slice(pos)];
}
