import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { INVITE_H, INVITE_W, nightHours, ukOrdinalFemSuffix } from '@/lib/prefest/invite';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';
import uk from '@/messages/uk.json';

/** Тексти картки «Запрошення» живуть у правках передстартового сайту: `prelaunch.prefest.mine.invite`. */
function tr(locale: string, messages: unknown) {
  return createTranslator({ locale, messages: messages as never, namespace: 'prelaunch.prefest.mine.invite' as never }) as unknown as (
    key: string,
    values?: Record<string, unknown>,
  ) => string;
}
const ord = (locale: string, messages: unknown, n: number) => tr(locale, messages)('ord', { n, s: ukOrdinalFemSuffix(n) });

describe('картка «Запрошення на новорічну ніч»', () => {
  it('кадр 1080×1920', () => {
    expect([INVITE_W, INVITE_H]).toEqual([1080, 1920]);
  });

  it('години ночі — від першої до останньої півночі', () => {
    expect(nightHours(Date.UTC(2026, 11, 31, 10), Date.UTC(2027, 0, 1, 12))).toBe(26);
  });

  it('порядкові жіночого роду українською («22-га північ»)', () => {
    const got = [1, 2, 3, 4, 7, 8, 11, 12, 13, 17, 20, 21, 22, 23, 27, 30, 31, 38].map((n) => ord('uk', uk, n));
    expect(got).toEqual([
      '1-ша', '2-га', '3-тя', '4-та', '7-ма', '8-ма', '11-та', '12-та', '13-та', '17-та',
      '20-та', '21-ша', '22-га', '23-тя', '27-ма', '30-та', '31-ша', '38-ма',
    ]);
  });

  it('порядкові англійською, іспанською, французькою', () => {
    expect([1, 2, 3, 11, 12, 13, 22, 38].map((n) => ord('en', en, n))).toEqual(['1st', '2nd', '3rd', '11th', '12th', '13th', '22nd', '38th']);
    expect([1, 22].map((n) => ord('es', es, n))).toEqual(['1.ª', '22.ª']);
    expect([1, 22].map((n) => ord('fr', fr, n))).toEqual(['1er', '22e']);
  });

  it('множини: «38 півночей», «26 годин» і відповідники', () => {
    const t = tr('uk', uk);
    expect([1, 2, 5, 21, 38].map((count) => t('midnights', { count }))).toEqual(['1 північ', '2 півночі', '5 півночей', '21 північ', '38 півночей']);
    expect(t('hours', { count: 26 })).toBe('26 годин');
    expect(tr('en', en)('midnights', { count: 38 })).toBe('38 midnights');
    expect(tr('es', es)('midnights', { count: 38 })).toBe('38 medianoches');
    expect(tr('fr', fr)('midnights', { count: 38 })).toBe('38 minuits');
  });

  it('усі 4 мови мають однаковий набір текстів картки', () => {
    const keys = (m: unknown) => Object.keys((m as { prelaunch: { prefest: { mine: { invite: object } } } }).prelaunch.prefest.mine.invite).sort();
    expect(keys(en)).toEqual(keys(uk));
    expect(keys(es)).toEqual(keys(uk));
    expect(keys(fr)).toEqual(keys(uk));
  });
});
