/**
 * Графік — це країни (рішення власника 2026-11-04, дошка `Desk-Schedule-Countries`): один запис = країна в її поясі.
 * Кілька подій тієї самої країни в тому самому поясі (Сідней і Мельбурн, Лос-Анджелес і Лас-Вегас) додаються й прибираються
 * разом: додали одну — у графіку всі, тож календарик на будь-якій із них (і на картці країни) показує один стан.
 *
 * Слоти поясу (рішення власника 2026-11-06, концепція `schedule-concept-2026-11-06.md`): у поясі до 4 країн — стільки
 * слотів, скільки країн у поясі, але не більше 4. П’ята країна не додається — вікно «Замінити в графіку?».
 * Порядок країн поясу — порядок додавання (перша додана — «вузол» на мапі шляху).
 * Саму логіку тримає спільний пакет правил (`@time2fest/rules/schedule`) — її викликають і сайт, і сервер (SPEC-11 AC-37);
 * тут лише перехід від набору даних сайту до каталогу правила.
 */
import { getData } from '@/lib/data/load';
import type { Dataset } from '@/lib/data/types';
import * as rule from '@time2fest/rules/schedule';
import type { ScheduleCatalog, ScheduleToggle } from '@time2fest/rules/schedule';

export type { ScheduleToggle };

/** Скільки країн поясу можна мати в графіку щонайбільше. */
export const ZONE_SLOT_LIMIT = rule.ZONE_SLOT_LIMIT;

const catalogs = new WeakMap<Dataset, ScheduleCatalog>();
/** Каталог правила з набору даних сайту (події; країни поясу — за містами поясу). Один на набір даних. */
function catalogOf(data: Dataset): ScheduleCatalog {
  let cat = catalogs.get(data);
  if (!cat) {
    const zoneCountries = new Map<string, string[]>();
    for (const c of data.cities) {
      const list = zoneCountries.get(c.zoneId);
      if (!list) zoneCountries.set(c.zoneId, [c.countryIso]);
      else if (!list.includes(c.countryIso)) list.push(c.countryIso);
    }
    cat = {
      events: data.events.map((e) => ({ eventId: e.id, zoneId: e.zoneId, countryIso: e.countryIso })),
      zoneCountryIsos: (zoneId) => zoneCountries.get(zoneId) ?? [],
    };
    catalogs.set(data, cat);
  }
  return cat;
}

/** Усі події країни в поясі цієї події (сама подія — теж); невідома подія — лише вона. */
export function countryZoneEvents(eventId: string, data: Dataset = getData()): string[] {
  return rule.countryZoneEvents(eventId, catalogOf(data));
}

/** Країни поясу (за містами поясу, як у списку «Країни й міста»). */
export function zoneCountryIsos(zoneId: string, data: Dataset = getData()): string[] {
  return [...catalogOf(data).zoneCountryIsos(zoneId)];
}

/** Скільки слотів у поясі: стільки, скільки країн, але не більше 4. */
export function zoneSlotCount(zoneId: string, data: Dataset = getData()): number {
  return rule.zoneSlotCount(zoneId, catalogOf(data));
}

/** Країни поясу в графіку — у порядку додавання (за першою подією країни в масиві графіка). */
export function scheduledCountries(schedule: readonly string[], zoneId: string, data: Dataset = getData()): string[] {
  return rule.scheduledCountries(schedule, zoneId, catalogOf(data));
}

/** Що станеться після натиску календарика: прибрати, додати чи пояс уже повний (тоді графік не змінюється). */
export function scheduleToggleResult(schedule: readonly string[], eventId: string, data: Dataset = getData()): ScheduleToggle {
  return rule.scheduleToggleResult(schedule, eventId, catalogOf(data));
}

/** Новий графік після натискання календарика: був хоч один запис країни в поясі — прибрати всі, інакше — додати всі
 *  (якщо в поясі є вільний слот; повний пояс — без змін). */
export function toggleCountryZone(schedule: readonly string[], eventId: string, data: Dataset = getData()): string[] {
  return rule.toggleCountryZone(schedule, eventId, catalogOf(data));
}

/** Замінити країну `outIso` у поясі події `eventId` на країну цієї події — на тому самому місці (слоті). */
export function replaceCountryZone(schedule: readonly string[], outIso: string, eventId: string, data: Dataset = getData()): string[] {
  return rule.replaceCountryZone(schedule, outIso, eventId, catalogOf(data));
}

/** Злиття графіків гостя й акаунта: події акаунта, далі країни гостя, доки в поясі є місце. */
export function mergeSchedules(accountIds: readonly string[], guestIds: readonly string[], data: Dataset = getData()): string[] {
  return rule.mergeSchedules(accountIds, guestIds, catalogOf(data));
}

/** Усі id — відомі й не приховані події? */
export function validateScheduleIds(ids: readonly string[], data: Dataset = getData()): boolean {
  return rule.validateScheduleIds(ids, catalogOf(data));
}
