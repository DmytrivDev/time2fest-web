import { createTranslator } from 'next-intl';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import uk from '@/messages/uk.json';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';

const UK = '{count, plural, one {# людина} few {# людини} many {# людей} other {# людини}}';
const TABLE = {
  uk: { messages: uk, now: `Зараз на Time2Fest ${UK}`, short: `На Time2Fest ${UK}` },
  en: { messages: en, now: 'Right now on Time2Fest: {count, plural, one {# person} other {# people}}', short: 'On Time2Fest: {count, plural, one {# person} other {# people}}' },
  es: { messages: es, now: 'Ahora en Time2Fest: {count, plural, one {# persona} other {# personas}}', short: 'En Time2Fest: {count, plural, one {# persona} other {# personas}}' },
  fr: { messages: fr, now: 'En ce moment sur Time2Fest : {count, plural, one {# personne} other {# personnes}}', short: 'Sur Time2Fest : {count, plural, one {# personne} other {# personnes}}' },
} as const;

type Tree = { [k: string]: string | Tree };
const keys = (t: Tree, p = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : keys(v, `${p}${k}.`)));

describe('AC-65: ключі player.peopleNow / peopleNowShort', () => {
  for (const [lang, row] of Object.entries(TABLE)) {
    it(`${lang}: тексти за таблицею, старі ключі прибрано, nav.viewers* лишились`, () => {
      const player = (row.messages as unknown as { player: Record<string, unknown> }).player;
      expect(player.peopleNow).toBe(row.now);
      expect(player.peopleNowShort).toBe(row.short);
      expect(player).not.toHaveProperty('watchersFrom');
      expect(player).not.toHaveProperty('watchersShort');
      const nav = (row.messages as unknown as { nav: Record<string, string> }).nav;
      expect(nav.viewersFrom).toBeTruthy();
      const t = (createTranslator as unknown as (o: object) => (k: string, v: object) => string)({ locale: lang, messages: row.messages, namespace: 'player' });
      expect(t('peopleNow', { count: 2 })).toContain('Time2Fest');
    });

    it(`${lang}: різниця ключів проти master — лише два додані, лише наявні старі прибрано`, () => {
      let base: string;
      try {
        base = execFileSync('git', ['show', `master:messages/${lang}.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      } catch {
        return; // немає гілки master (чиста копія) — перевірка недоступна
      }
      const before = new Set(keys(JSON.parse(base)));
      const after = new Set(keys(row.messages as unknown as Tree));
      const added = [...after].filter((k) => !before.has(k)).sort();
      const removed = [...before].filter((k) => !after.has(k)).sort();
      expect(added).toEqual(['player.peopleNow', 'player.peopleNowShort']);
      expect(removed).toEqual(lang === 'uk' ? ['player.watchersFrom', 'player.watchersShort'] : []);
    });
  }

  it('uk: 12480 → «12 480 людей»', () => {
    const t = (createTranslator as unknown as (o: object) => (k: string, v: object) => string)({ locale: 'uk', messages: uk, namespace: 'player' });
    expect(t('peopleNow', { count: 12480 })).toMatch(/12\s480 людей$/);
  });
});
