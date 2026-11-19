/** Виявлення посилань у тексті. Чисте: без годинника й мережі. */
export const TLDS =
  'com|net|org|info|io|me|ua|ru|de|uk|fr|es|pl|co|tv|ly|gl|gg|app|dev|xyz|biz|site|online|link|club|top|shop|store|cc|nl|ch|eu|us|ca|au|jp|cn|br|tk|ml|ws';
/** `http(s)://`, `www.`, «домен.зона» (в тому числі з `[.]` і пробілом перед крапкою не ловимо — це текст). */
const LINK_RE = new RegExp(
  String.raw`(?:https?://|www\.|(?:^|[^\p{L}\d@-])[a-z\d-]+(?:\.[a-z\d-]+)*\.(?:${TLDS})(?![\p{L}\d]))`,
  'iu',
);

export function hasLink(text: string): boolean {
  return LINK_RE.test(text);
}

/**
 * Перше посилання в тексті — `[start, end)` до найближчого пробілу (вікно тосту підкреслює «t.me/olena_ny» цілим,
 * дошка `Desk-Toast-New`, 2026-11-12). Межу слова перед доменом, яку захоплює вираз, не рахуємо.
 */
export function findLink(text: string): { start: number; end: number } | null {
  const m = LINK_RE.exec(text);
  if (!m) return null;
  const start = m.index + (/^[^\p{L}\d]/u.test(m[0]) ? 1 : 0);
  const rest = text.slice(m.index + m[0].length).search(/\s/);
  return { start, end: rest < 0 ? text.length : m.index + m[0].length + rest };
}
