/** Лінт правил тексту (SPEC-09, AC-3, AC-4, AC-6): копія правила, імпорт пакета, заборона запасного фільтра на сайті, лок-степ таблиць. Середовище jsdom, ESLint — через Node API. */
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import * as text from '@time2fest/rules/text';
import { EXTENDED_WORDS } from '../../../packages/rules/src/text/extended-words';
import { LIMIT_NAMES, LIMIT_VALUES, RULE_REGEX_SOURCES, RULE_WORDS } from '../../../packages/rules/eslint/no-text-rule-copy.mjs';

const root = path.resolve(__dirname, '../../..');
let eslint: ESLint;

// Перше завантаження конфігу триває до хвилини — прогріваємо один раз.
beforeAll(async () => {
  eslint = new ESLint({ cwd: root });
  await eslint.lintText('', { filePath: path.join(root, 'components/__warm__.tsx') });
}, 180_000);

async function lint(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return result!.messages;
}

const ids = <T extends { ruleId: string | null }>(messages: T[], ruleId: string) => messages.filter((m) => m.ruleId === ruleId);
const norm = (s: string) => s.replace(/\\\//g, '/');

describe('t2f-text/no-rule-copy (AC-3)', { timeout: 60_000 }, () => {
  const file = 'lib/__sample__.ts';
  const copies = async (code: string, f = file) => ids(await lint(code, f), 't2f-text/no-rule-copy');

  it('копія виразу правила (літерал і new RegExp) — помилка', async () => {
    const literal = 'export const re = /\\+?\\d[\\d\\s()-]{7,}\\d/;\n';
    const built = "export const re = new RegExp('[\\\\p{L}\\\\d._%+-]+@[\\\\p{L}\\\\d.-]+\\\\.[\\\\p{L}]{2,}', 'u');\n";
    expect(await copies(literal)).toHaveLength(1);
    expect(await copies(built)).toHaveLength(1);
  });

  it('копія списку слів (≥2 слів правила) — помилка; один збіг і чужі масиви — ні', async () => {
    expect(await copies("export const w = ['admin', 'fuck', 'banana'];\n")).toHaveLength(1);
    expect(await copies("export const w = ['support', 'orange', 'apple'];\n")).toHaveLength(0);
  });

  it('константа ліміту з числовим літералом — помилка', async () => {
    expect(await copies('export const MAX_TEXT = 200;\nconst NICK_MAX = 20;\nexport const x = NICK_MAX;\n')).toHaveLength(2);
    expect(await copies('export const SOMETHING_ELSE = 200;\n')).toHaveLength(0);
  });

  it('імпорт із пакета — без помилок', async () => {
    const code = "import { MAX_TEXT, checkToastText, validateNick } from '@time2fest/rules/text';\nexport const all = [MAX_TEXT, checkToastText, validateNick];\n";
    expect(await copies(code)).toHaveLength(0);
  });

  it('пакет і тести виключені з перевірки', async () => {
    expect(await copies('export const MAX_TEXT = 200;\n', 'packages/rules/src/text/__sample__.ts')).toHaveLength(0);
    expect(await copies('export const MAX_TEXT = 200;\n', 'tests/unit/__sample__.ts')).toHaveLength(0);
  });
});

describe('запасний фільтр не імпортується в збірку сайту (AC-6)', { timeout: 60_000 }, () => {
  const code = "import { fallbackVerdict } from '@time2fest/rules/text/fallback';\nexport const v = fallbackVerdict;\n";

  it.each(['components/__sample__.tsx', 'lib/__sample__.ts', 'lib/toast/__sample__.ts', 'app/__sample__.tsx', 'stores/__sample__.ts'])('%s → no-restricted-imports', async (f) => {
    const imports = ids(await lint(code, f), 'no-restricted-imports');
    expect(imports.some((m) => m.message.includes('Запасний фільтр'))).toBe(true);
  });

  it('імпорт з @time2fest/rules/text — дозволено', async () => {
    const ok = "import { MAX_TEXT } from '@time2fest/rules/text';\nexport const v = MAX_TEXT;\n";
    expect(ids(await lint(ok, 'components/__sample__.tsx'), 'no-restricted-imports')).toHaveLength(0);
  });
});

describe('лок-степ таблиць лінту з пакетом (AC-3)', () => {
  it('імена лімітів = експортам limits.ts, значення дозволених імен існують', () => {
    for (const name of LIMIT_NAMES) expect((text as Record<string, unknown>)[name]).toBe(LIMIT_VALUES[name as keyof typeof LIMIT_VALUES]);
    expect([...LIMIT_NAMES].sort()).toEqual(['MAX_TEXT', 'NICK_MAX', 'NICK_MIN', 'TOAST_MAX']);
  });

  it('вирази: EMAIL, PHONE, HANDLE — source пакета; LINK_RE — зібраний із TLDS', () => {
    expect(norm(RULE_REGEX_SOURCES.EMAIL)).toBe(norm(text.EMAIL.source));
    expect(norm(RULE_REGEX_SOURCES.PHONE)).toBe(norm(text.PHONE.source));
    expect(norm(RULE_REGEX_SOURCES.HANDLE)).toBe(norm(text.HANDLE.source));
    const link = new RegExp(RULE_REGEX_SOURCES.LINK_RE, 'iu');
    expect(RULE_REGEX_SOURCES.LINK_RE).toContain(text.TLDS);
    for (const s of ['https://a.b', 'www.site', 'olena.com', 't.me/olena_ny', 'привіт світ', 'a@b.com', '2026.11']) {
      expect(link.test(s)).toBe(text.hasLink(s));
    }
  });

  it('слова: таблиця = слова тосту ∪ службові слова ніка ∪ розширений список', () => {
    const expected = new Set([...text.TOAST_WORDS, ...text.NICK_SERVICE_WORDS, ...EXTENDED_WORDS]);
    expect(new Set(RULE_WORDS)).toEqual(expected);
  });

  it('зміна одного значення ламає звірку', () => {
    const changed = new Set([...RULE_WORDS, 'зайве-слово']);
    const expected = new Set([...text.TOAST_WORDS, ...text.NICK_SERVICE_WORDS, ...EXTENDED_WORDS]);
    expect(changed).not.toEqual(expected);
  });
});
