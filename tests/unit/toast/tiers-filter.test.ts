/**
 * Рівні тосту й фільтр до оплати (рішення власника 2026-11-12, дошки `Desk-Toast-New`, `Phone-Toast-New`).
 */
import { describe, expect, it } from 'vitest';
import { checkToastText } from '@/lib/toast/filter';
import { tierBenefits } from '@/lib/toast/tiers';

const on = (tier: 2 | 5 | 10, hasPass = false) => tierBenefits(tier, hasPass).filter((b) => b.included).map((b) => b.key);

describe('що дає рівень', () => {
  it('$2 — золотий тост; $5 — ще й закріплений; $10 — ще й нік у привітанні й пас у подарунок', () => {
    expect(on(2)).toEqual(['gold']);
    expect(on(5)).toEqual(['gold', 'pinned']);
    expect(on(10)).toEqual(['gold', 'pinned', 'greeting', 'pass']);
    expect(tierBenefits(2, false).map((b) => [b.key, b.from])).toEqual([
      ['gold', 2],
      ['pinned', 5],
      ['greeting', 10],
      ['pass', 10],
    ]);
  });

  it('з пасом: пас «уже є» замість подарунка — на будь-якому рівні; решта — як без пасу', () => {
    expect(on(10, true)).toEqual(['gold', 'pinned', 'greeting']);
    expect(tierBenefits(10, true).at(-1)).toEqual({ key: 'pass', from: 10, included: false, owned: true });
    expect(tierBenefits(2, true).at(-1)?.owned).toBe(true);
  });
});

describe('фільтр тосту — на «Оплатити», до оплати', () => {
  it('звичайний тост із емодзі проходить', () => {
    expect(checkToastText('🥂 За всіх, хто зустрічає разом!')).toBeNull();
    expect(checkToastText('Happy 2027, world ✨')).toBeNull();
    expect(checkToastText('Bonne année à tous ! Хай кожен знайде своїх')).toBeNull();
  });

  it('посилання — як у чаті; підкреслюємо до пробілу', () => {
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

  it('слова, яких не показуємо, — підкреслюємо слово цілком', () => {
    const text = 'Ну ти й сука, Новий рік!';
    const w = checkToastText(text)!;
    expect(w.kind).toBe('word');
    expect(text.slice(w.start, w.end)).toBe('сука');
  });
});
