/**
 * Правило графіка «Мій графік» — одна чиста функція для сайту й сервера (SPEC-11 AC-37).
 * Працює над подіями { eventId, zoneId, countryIso }: без припущення «сторінка = країна» й «одне місто на пояс»
 * (SPEC-24: регіон — нова подія-місто тієї ж країни в поясі). Не залежить від набору даних сайту.
 *
 * Один запис = країна в її поясі: усі події країни в поясі додаються й прибираються разом.
 * У поясі до 4 країн: слотів стільки, скільки країн у поясі, але не більше 4. Порядок — порядок додавання.
 */

export interface ScheduleEvent {
  eventId: string;
  zoneId: string;
  countryIso: string;
  /** Приховані події не можна ставити в графік (validateScheduleIds). */
  hidden?: boolean;
}

export interface ScheduleCatalog {
  events: readonly ScheduleEvent[];
  /** Країни поясу (за містами поясу). */
  zoneCountryIsos(zoneId: string): readonly string[];
}

export const ZONE_SLOT_LIMIT = 4;

export type ScheduleToggle = 'added' | 'removed' | 'full';

const byIdCache = new WeakMap<ScheduleCatalog, Map<string, ScheduleEvent>>();
function eventsById(cat: ScheduleCatalog): Map<string, ScheduleEvent> {
  let m = byIdCache.get(cat);
  if (!m) {
    m = new Map(cat.events.map((e) => [e.eventId, e]));
    byIdCache.set(cat, m);
  }
  return m;
}

/** Усі події країни в поясі цієї події (сама подія — теж); невідома подія — лише вона. */
export function countryZoneEvents(eventId: string, cat: ScheduleCatalog): string[] {
  const e = eventsById(cat).get(eventId);
  if (!e) return [eventId];
  return cat.events.filter((x) => x.zoneId === e.zoneId && x.countryIso === e.countryIso && !x.hidden).map((x) => x.eventId);
}

/** Скільки слотів у поясі: стільки, скільки країн, але не більше 4. */
export function zoneSlotCount(zoneId: string, cat: ScheduleCatalog): number {
  return Math.min(ZONE_SLOT_LIMIT, new Set(cat.zoneCountryIsos(zoneId)).size);
}

/** Країни поясу в графіку — у порядку додавання (за першою подією країни в масиві графіка). */
export function scheduledCountries(schedule: readonly string[], zoneId: string, cat: ScheduleCatalog): string[] {
  const byId = eventsById(cat);
  const out: string[] = [];
  for (const id of schedule) {
    const e = byId.get(id);
    if (e && e.zoneId === zoneId && !out.includes(e.countryIso)) out.push(e.countryIso);
  }
  return out;
}

/** Що станеться після натиску календарика: прибрати, додати чи пояс уже повний. */
export function scheduleToggleResult(schedule: readonly string[], eventId: string, cat: ScheduleCatalog): ScheduleToggle {
  const group = countryZoneEvents(eventId, cat);
  if (group.some((id) => schedule.includes(id))) return 'removed';
  const e = eventsById(cat).get(eventId);
  if (!e) return 'added';
  return scheduledCountries(schedule, e.zoneId, cat).length >= zoneSlotCount(e.zoneId, cat) ? 'full' : 'added';
}

/** Новий графік після натискання: був запис країни в поясі — прибрати всі, інакше додати всі (повний пояс — без змін). */
export function toggleCountryZone(schedule: readonly string[], eventId: string, cat: ScheduleCatalog): string[] {
  const group = countryZoneEvents(eventId, cat);
  const result = scheduleToggleResult(schedule, eventId, cat);
  if (result === 'removed') return schedule.filter((id) => !group.includes(id));
  if (result === 'full') return [...schedule];
  return [...new Set([...schedule, ...group])];
}

/** Замінити країну `outIso` у поясі події `eventId` на країну цієї події — на тому самому місці (слоті). */
export function replaceCountryZone(schedule: readonly string[], outIso: string, eventId: string, cat: ScheduleCatalog): string[] {
  const e = eventsById(cat).get(eventId);
  if (!e) return [...schedule];
  const out = new Set(cat.events.filter((x) => x.zoneId === e.zoneId && x.countryIso === outIso).map((x) => x.eventId));
  const group = countryZoneEvents(eventId, cat).filter((id) => !schedule.includes(id));
  const at = schedule.findIndex((id) => out.has(id));
  const kept = schedule.filter((id) => !out.has(id));
  if (at < 0) return [...new Set([...kept, ...group])];
  const pos = schedule.slice(0, at).filter((id) => !out.has(id)).length;
  return [...kept.slice(0, pos), ...group, ...kept.slice(pos)];
}

/**
 * Злиття графіків гостя й акаунта (AC-52): спершу події акаунта, далі країни гостя в порядку гостя,
 * доки в поясі є вільний слот. Країна, що вже є, не дублюється; невідомі події гостя відкидаються.
 */
export function mergeSchedules(accountIds: readonly string[], guestIds: readonly string[], cat: ScheduleCatalog): string[] {
  const byId = eventsById(cat);
  let out = [...new Set(accountIds)];
  for (const id of guestIds) {
    if (!byId.has(id) || byId.get(id)!.hidden) continue;
    if (scheduleToggleResult(out, id, cat) === 'added') out = toggleCountryZone(out, id, cat);
  }
  return out;
}

/** Усі id — відомі, не приховані події каталогу? (невідома або прихована → false). */
export function validateScheduleIds(ids: readonly string[], cat: ScheduleCatalog): boolean {
  const byId = eventsById(cat);
  return ids.every((id) => {
    const e = byId.get(id);
    return !!e && !e.hidden;
  });
}
