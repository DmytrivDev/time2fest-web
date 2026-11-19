/** Правила тексту в пакеті: приклади з тестів сайту (`tiers-filter`, `chat-sim/send`) без змін очікувань. */
import { describe, expect, it } from 'vitest';
import { checkToastText, findLink, hasLink, validateNick, MAX_TEXT, NICK_MAX, NICK_MIN, TOAST_MAX, textRulesFor } from '../src/text/index';

describe('фільтр тосту', () => {
  it('звичайний тост із емодзі проходить', () => {
    expect(checkToastText('🥂 За всіх, хто зустрічає разом!')).toBeNull();
    expect(checkToastText('Happy 2027, world ✨')).toBeNull();
    expect(checkToastText('Bonne année à tous ! Хай кожен знайде своїх')).toBeNull();
  });

  it('посилання — підкреслюємо до пробілу', () => {
    const text = 'Пишіть мені: t.me/olena_ny 🎉';
    const issue = checkToastText(text)!;
    expect(issue.kind).toBe('link');
    expect(text.slice(issue.start, issue.end)).toBe('t.me/olena_ny');
    const www = checkToastText('дивіться www.spam.com зараз')!;
    expect(www.kind).toBe('link');
    expect('дивіться www.spam.com зараз'.slice(www.start, www.end)).toBe('www.spam.com');
  });

  it('контакти: пошта, телефон, @нік', () => {
    const mail = 'пишіть olena@example.com';
    const m = checkToastText(mail)!;
    expect(m.kind).toBe('contact');
    expect(mail.slice(m.start, m.end)).toBe('olena@example.com');
    const phone = 'дзвоніть +380 67 123 45 67';
    const p = checkToastText(phone)!;
    expect(p.kind).toBe('contact');
    expect(phone.slice(p.start, p.end)).toBe('+380 67 123 45 67');
    const handle = 'шукайте @olena_ny';
    expect(handle.slice(checkToastText(handle)!.start, checkToastText(handle)!.end)).toBe('@olena_ny');
  });

  it('слово, якого не показуємо, — цілком', () => {
    const text = 'Ну ти й сука, Новий рік!';
    const w = checkToastText(text)!;
    expect(w.kind).toBe('word');
    expect(text.slice(w.start, w.end)).toBe('сука');
  });
});

describe('hasLink / findLink', () => {
  it.each(['https://example.com', 'http://a.b', 'www.example.com', 'дивись example.com/thames', 'my.site.org', 'EXAMPLE.COM'])(
    '«%s» — посилання',
    (text) => expect(hasLink(text)).toBe(true),
  );
  it.each(['З Новим роком!', 'Happy New Year, друзі.', 'о 23.59 буде салют', 'написав@Karim', 'Привіт.Усім'])('«%s» — не посилання', (text) =>
    expect(hasLink(text)).toBe(false),
  );
  it('findLink: null без посилання', () => expect(findLink('привіт')).toBeNull());
});

describe('validateNick', () => {
  it('межі, посилання, службові слова, зайнятий', () => {
    expect(validateNick('А')).toBe('short');
    expect(validateNick('а'.repeat(21))).toBe('long');
    expect(validateNick('Мирон')).toBeNull();
    expect(validateNick('Ab')).toBeNull();
    expect(validateNick('a'.repeat(20))).toBeNull();
    expect(validateNick('www.site.com')).toBe('link');
    expect(validateNick('аміра', ['Аміра'])).toBe('taken');
    expect(validateNick('Admin')).toBe('forbidden');
  });
});

describe('ліміти й textRulesFor', () => {
  it('константи', () => expect([MAX_TEXT, NICK_MIN, NICK_MAX, TOAST_MAX]).toEqual([200, 2, 20, 120]));
  it('message', () => {
    expect(textRulesFor('message', '')).toEqual({ reason: 'empty' });
    expect(textRulesFor('message', 'a'.repeat(201))).toEqual({ reason: 'too-long' });
    expect(textRulesFor('message', 'see www.x.com')).toEqual({ reason: 'link-forbidden' });
    expect(textRulesFor('message', 'З Новим роком!')).toBeNull();
  });
  it('nick без taken', () => {
    expect(textRulesFor('nick', 'А')).toEqual({ reason: 'short' });
    expect(textRulesFor('nick', 'Мирон')).toBeNull();
  });
  it('toast', () => {
    expect(textRulesFor('toast', 'a'.repeat(121))).toEqual({ reason: 'too-long' });
    expect(textRulesFor('toast', 'ти сука')).toEqual({ reason: 'word' });
    expect(textRulesFor('toast', 'Happy 2027')).toBeNull();
  });
});
