/**
 * Графік — це країни (рішення власника 2026-11-04, дошка `Desk-Schedule-Countries`): один запис = країна в її поясі.
 * Кілька подій тієї самої країни в тому самому поясі (Сідней і Мельбурн, Лос-Анджелес і Лас-Вегас) додаються й прибираються
 * разом: додали одну — у графіку всі, тож календарик на будь-якій із них (і на картці країни) показує один стан.
 */
import { getData } from '@/lib/data/load';

/** Усі події країни в поясі цієї події (сама подія — теж); невідома подія — лише вона. */
export function countryZoneEvents(eventId: string): string[] {
  const data = getData();
  const e = data.eventsById.get(eventId);
  if (!e) return [eventId];
  return data.events.filter((x) => x.zoneId === e.zoneId && x.countryIso === e.countryIso).map((x) => x.id);
}

/** Новий графік після натискання календарика події: був хоч один запис країни в поясі — прибрати всі, інакше — додати всі. */
export function toggleCountryZone(schedule: readonly string[], eventId: string): string[] {
  const group = countryZoneEvents(eventId);
  const on = group.some((id) => schedule.includes(id));
  return on ? schedule.filter((id) => !group.includes(id)) : [...new Set([...schedule, ...group])];
}
