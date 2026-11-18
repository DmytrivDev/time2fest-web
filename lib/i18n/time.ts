/**
 * Форматування часу для людини (EXPERIENCE «Час і відлік»): головне — місцевий час гостя
 * («03:00 за вашим часом»), дата лише якщо інший день, 12/24 год за мовою; UTC — тільки для підказки.
 * Усі функції чисті: «зараз» і пояс передаються аргументами.
 */
import type { ISO, Ms } from '@/lib/data/types';

export type Locale = 'uk' | (string & {});

const PHRASES: Record<string, { yourTime: string; midnightWas: string }> = {
  uk: { yourTime: 'за вашим часом', midnightWas: 'північ була' },
  en: { yourTime: 'your time', midnightWas: 'midnight was' },
};
const phrase = (locale: Locale) => PHRASES[locale] ?? PHRASES.uk!;

/**
 * Мова, якою форматується час, коли її не передано аргументом. Сайт ефіру — українською; мовне дерево
 * (`app/[locale]`) ставить мову сторінки один раз, у своєму провайдері (у браузері сторінка має одну мову).
 */
let defaultLocale: Locale = 'uk';
export function setDefaultTimeLocale(locale: Locale): void {
  defaultLocale = locale;
}
export function defaultTimeLocale(): Locale {
  return defaultLocale;
}

/**
 * Кеш `Intl.DateTimeFormat`: створення форматера дороге (сотні мікросекунд), а час на сторінці форматується
 * щосекунди в мапі, картках і чаті — без кешу це блокувало головний потік і «пригальмовувало» анімації (2026-10-31).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

let viewerZone: string | null = null;
/**
 * Передстартовий сайт: до гідратації час форматується за UTC — так само, як у статичному HTML (і на машині збирання, і
 * в браузері), щоб розмітка збіглася; після гідратації — за поясом відвідувача (`components/prelaunch/SiteProvider`).
 * Сайт свята цього не вмикає: там час до гідратації не показується.
 */
let holdUtc = false;
export function holdViewerTimeZoneUtc(on: boolean): void {
  holdUtc = on;
}
export function viewerTimeZone(): string {
  if (holdUtc) return 'UTC';
  if (viewerZone) return viewerZone;
  try {
    viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    viewerZone = 'UTC';
  }
  return viewerZone;
}

/** Застарілі назви поясів IANA, які ще повертають деякі системи (напр. `Europe/Kiev`), → сучасні (правка власника 2026-10-31). */
const ZONE_RENAMES: Record<string, string> = {
  Kiev: 'Kyiv',
  Calcutta: 'Kolkata',
  Saigon: 'Ho Chi Minh',
  Rangoon: 'Yangon',
  Katmandu: 'Kathmandu',
  Godthab: 'Nuuk',
};

/** Місто поясу гостя для підпису «за вашим часом (Kyiv)»: остання частина назви IANA, сучасне написання. */
export function viewerZoneLabel(zone: string = viewerTimeZone()): string {
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? '';
  return ZONE_RENAMES[city] ?? city;
}

function toMs(v: ISO | Ms): Ms {
  return typeof v === 'number' ? v : Date.parse(v);
}

function dayKey(ms: Ms, timeZone: string): string {
  return dtf('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Годину й хвилини у форматі мови: «03:00» (uk, 24 год) або «3:00 AM» (en-US, 12 год). */
export function formatClock(utc: ISO | Ms, opts: { locale?: Locale; timeZone?: string } = {}): string {
  const locale = opts.locale ?? defaultLocale;
  const timeZone = opts.timeZone ?? viewerTimeZone();
  const probe = dtf(locale, { hour: 'numeric', timeZone }).resolvedOptions();
  const h12 = probe.hourCycle === 'h11' || probe.hourCycle === 'h12';
  return dtf(locale, {
    hour: h12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(toMs(utc));
}

export interface ViewerTime {
  /** «03:00» / «3:00 AM». */
  time: string;
  /** «1 січня», якщо день півночі відрізняється від сьогоднішнього дня гостя; інакше `null`. */
  date: string | null;
  sameDay: boolean;
  /** «03:00 за вашим часом» або «1 січня, 03:00 за вашим часом». */
  text: string;
  /** Підказка: «00:00 UTC». */
  utcHint: string;
}

export function formatTimeForViewer(
  utc: ISO | Ms,
  opts: { now: Ms; locale?: Locale; timeZone?: string },
): ViewerTime {
  const locale = opts.locale ?? defaultLocale;
  const timeZone = opts.timeZone ?? viewerTimeZone();
  const ms = toMs(utc);
  const time = formatClock(ms, { locale, timeZone });
  const sameDay = dayKey(ms, timeZone) === dayKey(opts.now, timeZone);
  const date = sameDay
    ? null
    : dtf(locale, { day: 'numeric', month: 'long', timeZone }).format(ms);
  const p = phrase(locale);
  return {
    time,
    date,
    sameDay,
    text: date ? `${date}, ${time} ${p.yourTime}` : `${time} ${p.yourTime}`,
    utcHint: formatUtcHint(ms),
  };
}

/** «00:00 UTC» — лише для підказки (картка поясу). */
export function formatUtcHint(utc: ISO | Ms): string {
  const d = new Date(toMs(utc));
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/** «38 хв тому» (`Intl.RelativeTimeFormat`, короткий стиль); `elapsedMs ≥ 0`. */
export function formatAgo(elapsedMs: Ms, locale: Locale = defaultLocale): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { style: 'short', numeric: 'always' });
  const sec = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (sec < 60) return rtf.format(-sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  return rtf.format(-Math.floor(min / 60), 'hour');
}

/** «північ була 38 хв тому». */
export function formatMidnightAgo(elapsedMs: Ms, locale: Locale = defaultLocale): string {
  return `${phrase(locale).midnightWas} ${formatAgo(elapsedMs, locale)}`;
}

/** Секунди відліку: округлення вгору, щоб «00:00:00» настало рівно опівночі. */
function ceilSec(ms: Ms): number {
  return Math.max(0, Math.ceil(ms / 1_000));
}

/**
 * Відлік понад добу з днями — «29:23:59:59» (дні без нуля попереду, без літери; рішення власника 2026-11-18). Увімкнено
 * у збірці передстартового сайту, де до півночі — тижні: замість «1034:35:36». Сайт свята (демо) лишає години.
 */
export const COUNTDOWN_DAYS = process.env.NEXT_PUBLIC_PRELAUNCH === '1';

/** Відлік до півночі «00:22:15» (години, хвилини, секунди); з `days` і понад добу — «29:23:59:59». */
export function formatCountdown(ms: Ms, days: boolean = COUNTDOWN_DAYS): string {
  const s = ceilSec(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const d = days ? Math.floor(s / 86_400) : 0;
  const h = Math.floor((s - d * 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  return d > 0 ? `${d}:${p(h)}:${p(m)}:${p(s % 60)}` : `${p(h)}:${p(m)}:${p(s % 60)}`;
}

/** «54 хв», «2 год 54 хв», «1 год» — скільки лишилось (округлення вгору до хвилини). */
export function formatDurationShort(ms: Ms, locale: Locale = defaultLocale): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  const [hh, mm] = locale === 'uk' ? ['год', 'хв'] : ['h', 'min'];
  if (!h) return `${m} ${mm}`;
  return m ? `${h} ${hh} ${m} ${mm}` : `${h} ${hh}`;
}

/** Короткий відлік переходу «0:59» / «1:00» (хвилини без нуля попереду). */
export function formatShortCountdown(ms: Ms): string {
  const s = ceilSec(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** «UTC+5:45» — зсув поясу для підпису в картці поясу. */
export function utcLabel(offsetMinutes: number): string {
  const a = Math.abs(offsetMinutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const sign = offsetMinutes < 0 ? '−' : '+';
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
