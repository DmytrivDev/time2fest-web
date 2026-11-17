/**
 * Час для головної «до свята» — за часовим поясом відвідувача (браузер): «12:00», «31 грудня», «UTC+5:45».
 * Обгортки над `lib/i18n/time`, щоб блоки сторінки писали час однаково.
 */
import type { Ms } from '@/lib/data/types';
import { formatClock, utcLabel, viewerTimeZone } from '@/lib/i18n/time';

export { utcLabel };

/** «12:00» за часом відвідувача. */
export function clock(ms: Ms, timeZone?: string): string {
  return formatClock(ms, { locale: 'uk', ...(timeZone ? { timeZone } : {}) });
}

/** «31 грудня» за часом відвідувача. */
export function dayMonth(ms: Ms, timeZone?: string): string {
  return new Intl.DateTimeFormat('uk', {
    day: 'numeric',
    month: 'long',
    timeZone: timeZone ?? viewerTimeZone(),
  }).format(ms);
}

/** Зсув пояса відвідувача (хв) у мить `ms` — щоб знайти «свій» пояс у ніч свята. */
export function viewerOffsetMinutes(ms: Ms): number {
  return -new Date(ms).getTimezoneOffset();
}

/** Назва пояса браузера для підпису: «Europe/Kyiv» → «Europe/Kyiv» без підкреслень. */
export function viewerZoneName(): string {
  try {
    return viewerTimeZone().replace(/_/g, ' ');
  } catch {
    return '';
  }
}
