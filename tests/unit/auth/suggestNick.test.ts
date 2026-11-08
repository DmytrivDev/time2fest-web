/** Нік після створення акаунта (рішення власника 2026-11-08): перше слово, лише літери; ніколи вся пошта. */
import { describe, expect, it } from 'vitest';
import { generatedNick, suggestNick } from '@/lib/auth/suggestNick';

describe('suggestNick', () => {
  it.each([
    ['olena.kovalenko1987@gmail.com', 'Olena'],
    ['ivan_petrenko@ukr.net', 'Ivan'],
    ['j.smith@outlook.com', 'Smith'],
    ['anna2000@gmail.com', 'Anna'],
    ['MARIA-lopez@mail.es', 'Maria'],
  ])('%s → %s', (email, nick) => {
    expect(suggestNick({ email })).toBe(nick);
  });
  it('без літер — null (тоді «Гість NNNN»)', () => {
    expect(suggestNick({ email: '12345@gmail.com' })).toBeNull();
    expect(generatedNick('Гість', () => 0.5)).toBe('Гість 5500');
  });
  it('Google — лише ім’я; гостьовий нік з чату — першим', () => {
    expect(suggestNick({ email: 'you@gmail.com', googleName: 'Олена Коваленко' })).toBe('Олена');
    expect(suggestNick({ email: 'you@gmail.com', googleName: 'Олена', chatNick: 'Зірочка' })).toBe('Зірочка');
  });
  it('заборонене слово не підставляємо', () => {
    expect(suggestNick({ email: 'admin@site.com' })).toBeNull();
  });
});
