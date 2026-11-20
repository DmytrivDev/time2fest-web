// «Ловець» відмінювання (ІНВ 5.4, FR-090): назви країн і міст ніколи не стоять у формі, що вимагає відмінка.
// Проганяємо всі повідомлення з тестовою підстановкою й шукаємо прийменники «в / у / на» просто перед нею.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/uk.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const SENTINEL = 'ЗНАЧ';
const NUMERIC = new Set([
  'count', 'days', 'hours', 'minutes', 'seconds', 'n', 'index', 'total', 'free', 'taken',
  'countries', 'continents', 'zones', 'zonesTotal',
]);

/** Імена аргументів, що трапляються в повідомленні (включно з вкладеними в select / plural). */
function argNames(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g)) names.add(m[1] as string);
  return [...names];
}

function argsFor(message: string): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  for (const name of argNames(message)) {
    if (name === 'gender') args[name] = 'm';
    else if (NUMERIC.has(name)) args[name] = 2;
    else args[name] = SENTINEL;
  }
  return args;
}

const PREPOSITION_BEFORE_ARG = new RegExp(`(^|[\\s(«"“‘—-])(в|у|на)\\s+[«"“‘]?${SENTINEL}`, 'iu');
const RAW_PREPOSITION_BEFORE_ARG = /(^|[\s(«"“‘—-])(в|у|на)\s+[«"“‘]?\{\s*[A-Za-z_]\w*\s*[,}]/iu;
const FORBIDDEN_WORD = /(?<![\p{L}])(ніч|ночі|ніччю|ночей)(?![\p{L}])/iu;

const flat = flatten(messages as Tree);
const t = createTranslator({ locale: 'uk', messages: messages as never });

describe('словник uk.json', () => {
  it('містить повідомлення', () => {
    expect(Object.keys(flat).length).toBeGreaterThan(100);
  });

  it('ловець працює: помічає «в <місто>» і пропускає «Країна: <країна>»', () => {
    expect(PREPOSITION_BEFORE_ARG.test(`Вечірка в ${SENTINEL}`)).toBe(true);
    expect(PREPOSITION_BEFORE_ARG.test(`Вечірка на «${SENTINEL}»`)).toBe(true);
    expect(PREPOSITION_BEFORE_ARG.test(`Країна: ${SENTINEL}`)).toBe(false);
    expect(PREPOSITION_BEFORE_ARG.test(`Рейтинг · ${SENTINEL}`)).toBe(false);
  });

  it.each(Object.entries(flat))('«%s»: усі повідомлення розбираються й без відмінювання', (key, raw) => {
    expect(RAW_PREPOSITION_BEFORE_ARG.test(raw), `прийменник перед підстановкою в «${key}»: ${raw}`).toBe(false);
    const rendered = (t as unknown as (k: string, v: Record<string, string | number>) => string)(key, argsFor(raw));
    expect(typeof rendered).toBe('string');
    expect(PREPOSITION_BEFORE_ARG.test(rendered), `прийменник перед підстановкою в «${key}»: ${rendered}`).toBe(false);
  });

  // Виняток — картка «Запрошення на новорічну ніч» передстартового сайту: назву з «ніч» затвердив власник
  // (docs/decision.md, 2026-11-20 день); решта словника — без «ніч».
  const NIGHT_ALLOWED = /^prelaunch\.prefest\.mine\.invite\.(title2|night|aria)$/;
  it('не містить слова «ніч» (конституція)', () => {
    for (const [key, raw] of Object.entries(flat)) {
      if (NIGHT_ALLOWED.test(key)) continue;
      expect(FORBIDDEN_WORD.test(raw), `слово «ніч» у «${key}»: ${raw}`).toBe(false);
    }
  });
});
