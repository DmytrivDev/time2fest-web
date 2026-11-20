/** Запасний фільтр: AC-7 (без мережі й таймерів), AC-8 (не м'якший за правила), AC-9 (ловить те, що клієнт пропускає), NFR-3. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackVerdict } from '../src/text/fallback';
import { textRulesFor, type TextKind } from '../src/text/index';

const KINDS: TextKind[] = ['message', 'nick', 'toast'];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AC-7 — без мережі й таймерів', () => {
  it('є результат; fetch не викликано; таймер не заведено', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
    expect(fallbackVerdict('message', 'З Новим роком!')).toBe('allow');
    expect(fallbackVerdict('toast', 'ти сука')).toBe('block');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('AC-8 — правила відхиляють ⇒ запасний фільтр блокує', () => {
  const examples = ['', ' ', 'a'.repeat(201), 'https://example.com', 'www.site.com', 'my.site.org', 'olena@example.com', '+380 67 123 45 67', 'сука', 'Admin', 'А', 'а'.repeat(21), 'a'.repeat(121)];
  for (const kind of KINDS) {
    it(`вид ${kind}`, () => {
      for (const text of examples) {
        if (textRulesFor(kind, text)) expect(fallbackVerdict(kind, text), `${kind}: «${text}»`).toBe('block');
      }
    });
  }
});

describe('AC-9 — клієнт пропускає, запасний блокує', () => {
  const contact = ['пишіть olena@example.com', 'дзвоніть +380 67 123 45 67', 'шукайте @olena_ny'];
  const word = ['ти мудак', 'ну ти й asshole', 'який сволоч'];
  it.each(contact)('контакт у повідомленні: «%s»', (t) => {
    expect(textRulesFor('message', t)).toBeNull();
    expect(fallbackVerdict('message', t)).toBe('block');
  });
  it.each(word)('розширений список: «%s»', (t) => {
    expect(textRulesFor('toast', t)).toBeNull();
    expect(fallbackVerdict('toast', t)).toBe('block');
    expect(fallbackVerdict('message', t)).toBe('block');
  });
  it('чистий текст проходить', () => expect(fallbackVerdict('message', 'З Новим роком, друзі!')).toBe('allow'));
});

describe('NFR-3 — швидкість', () => {
  it('10 000 текстів по 200 символів ≤ 500 мс', () => {
    const text = 'З Новим роком, друзі! '.repeat(10).slice(0, 200);
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) fallbackVerdict('message', text + i);
    const ms = performance.now() - t0;
    console.log(`NFR-3: 10000 x 200 chars in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThanOrEqual(500);
  });
});
