/**
 * Коли тост можна сказати (рішення власника 2026-11-13): лише поки свято йде — те саме правило, що `isCelebrating`
 * (від 2 год до першої півночі до 2 год після останньої); до й після — ні (кінець — 2026-11-14).
 */
import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import {
  canSayToast,
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  isCelebrating,
  toastSeason,
  toastsOpenAt,
} from '@time2fest/rules/time';

const H = 3_600_000;
const FIRST = Date.UTC(2026, 11, 31, 10, 0); // північ UTC+14
const LAST = Date.UTC(2027, 0, 1, 12, 0); // північ UTC−12
const zones = [{ midnightMs: LAST }, { midnightMs: FIRST }, { midnightMs: Date.UTC(2026, 11, 31, 22, 0) }] as never;
const data = { zones };

describe('canSayToast / toastSeason', () => {
  it('до свята — ні: за кілька днів і за мить до відкриття', () => {
    for (const now of [Date.UTC(2026, 11, 28, 12, 0), FIRST - CELEBRATION_LEAD - 1]) {
      expect(canSayToast(now, data)).toBe(false);
      expect(toastSeason(now, data)).toBe('before');
    }
  });

  it('свято йде — так: від 2 год до першої півночі до 2 год після останньої півночі включно', () => {
    for (const now of [FIRST - 2 * H, FIRST, Date.UTC(2026, 11, 31, 22, 40), LAST, LAST + 1_000, LAST + CELEBRATION_TAIL - 1_000, LAST + CELEBRATION_TAIL]) {
      expect(canSayToast(now, data)).toBe(true);
      expect(toastSeason(now, data)).toBe('during');
    }
  });

  it('після свята — ні: за секунду після «остання північ + 2 год» і через день', () => {
    for (const now of [LAST + CELEBRATION_TAIL + 1_000, Date.UTC(2027, 0, 2, 12, 0)]) {
      expect(canSayToast(now, data)).toBe(false);
      expect(toastSeason(now, data)).toBe('after');
    }
  });

  it('час невідомий (0) чи поясів немає — «до свята», тосту немає', () => {
    expect(toastSeason(0, data)).toBe('before');
    expect(canSayToast(FIRST, { zones: [] })).toBe(false);
    expect(toastSeason(FIRST, { zones: [] })).toBe('before');
    expect(toastsOpenAt({ zones: [] })).toBeNull();
  });

  it('тости відкриваються за 2 год до першої півночі', () => {
    expect(toastsOpenAt(data)).toBe(FIRST - 2 * H);
  });

  it('на справжніх даних збігається з isCelebrating у точках перевірки сайту', () => {
    const real = getData();
    for (const iso of ['2026-12-28T12:00:00Z', '2026-12-31T22:40:00Z', '2027-01-02T12:00:00Z']) {
      const now = Date.parse(iso);
      expect(canSayToast(now, real)).toBe(isCelebrating(now, real));
    }
    expect(toastSeason(Date.parse('2026-12-28T12:00:00Z'), real)).toBe('before');
    expect(toastSeason(Date.parse('2026-12-31T22:40:00Z'), real)).toBe('during');
    expect(toastSeason(Date.parse('2027-01-02T12:00:00Z'), real)).toBe('after');
  });
});
