/**
 * Тексти до гідратації (SEO-звіт, розділ 4): у готовому HTML час півночі — за UTC (`holdViewerTimeZoneUtc`), тож і
 * підпис має казати «за UTC», а не «за твоїм часом». Після гідратації сторінка бере звичайні тексти й час відвідувача.
 * Заміни — за мовою сторінки; від довшої фрази до коротшої.
 */
import type { AbstractIntlMessages } from 'next-intl';

const PHRASES: Record<string, readonly (readonly [RegExp, string])[]> = {
  uk: [
    [/за (твоїм|вашим) часом/g, 'за UTC'],
    [/За (твоїм|вашим) часом/g, 'За UTC'],
  ],
  en: [
    [/in your local time/g, 'in UTC'],
    [/in your time/g, 'in UTC'],
    [/your local time/g, 'UTC'],
    [/your time/g, 'UTC'],
    [/Your time/g, 'UTC'],
  ],
  es: [
    [/en tu hora local/g, 'en UTC'],
    [/a tu hora/g, 'en UTC'],
    [/en tu hora/g, 'en UTC'],
    [/tu hora local/g, 'UTC'],
    [/tu hora/g, 'UTC'],
    [/Tu hora/g, 'UTC'],
  ],
  fr: [
    [/à ton heure locale/g, 'en UTC'],
    [/à ton heure/g, 'en UTC'],
    [/ton heure/g, 'UTC'],
    [/Ton heure/g, 'UTC'],
  ],
};

function mapStrings(tree: AbstractIntlMessages, fn: (s: string) => string): AbstractIntlMessages {
  const out: AbstractIntlMessages = {};
  for (const [k, v] of Object.entries(tree)) out[k] = typeof v === 'string' ? fn(v) : mapStrings(v, fn);
  return out;
}

export function utcWording(messages: AbstractIntlMessages, locale: string): AbstractIntlMessages {
  const rules = PHRASES[locale];
  if (!rules) return messages;
  return mapStrings(messages, (s) => rules.reduce((acc, [re, to]) => acc.replace(re, to), s));
}
