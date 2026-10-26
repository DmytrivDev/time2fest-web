/**
 * Прапор за розташуванням для O-NICK (US4, FR-051). У цій області — лише локальна оцінка за мовою браузера й
 * часовим поясом (`Intl`): жодних запитів і жодної IP-адреси (принцип VI). Невідомо → `undefined`
 * (вікно покаже «Прапор не визначено — обери свій» і «Земля — Без країни»).
 */

const TZ_REGION: Record<string, string> = {
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/London': 'GB',
  'Europe/Warsaw': 'PL',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Istanbul': 'TR',
  'Europe/Prague': 'CZ',
  'Europe/Vienna': 'AT',
  'Europe/Amsterdam': 'NL',
  'Europe/Lisbon': 'PT',
  'Europe/Dublin': 'IE',
  'Africa/Cairo': 'EG',
  'Asia/Dubai': 'AE',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Kolkata': 'IN',
  'Australia/Sydney': 'AU',
  'Pacific/Auckland': 'NZ',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Los_Angeles': 'US',
  'America/Sao_Paulo': 'BR',
};

/** Мова без регіону → найімовірніша країна (мова інтерфейсу сайту — українська). */
const LANG_REGION: Record<string, string> = { uk: 'UA' };

const ISO2 = /^[A-Z]{2}$/;

export interface DetectInput {
  languages?: readonly string[];
  timeZone?: string;
}

/** Чиста частина: можна перевірити в тестах без браузера. */
export function detectFlagFrom({ languages = [], timeZone }: DetectInput): string | undefined {
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).region;
      if (region && ISO2.test(region)) return region;
    } catch {
      // некоректний тег — пропускаємо
    }
  }
  const tz = timeZone ? TZ_REGION[timeZone] : undefined;
  if (tz) return tz;
  for (const tag of languages) {
    const lang = tag.split('-')[0]?.toLowerCase();
    const fallback = lang ? LANG_REGION[lang] : undefined;
    if (fallback) return fallback;
  }
  return undefined;
}

export function detectFlag(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return detectFlagFrom({ languages: navigator.languages?.length ? navigator.languages : [navigator.language], timeZone });
}
