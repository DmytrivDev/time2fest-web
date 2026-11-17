import { describe, expect, it } from 'vitest';
import { cardLayout, showDescribedCount, soonFlagIsos } from '@/lib/prefest/countryCards';

describe('cardLayout', () => {
  it('0 описаних — блок прихований', () => {
    expect(cardLayout(0)).toMatchObject({ visible: false, cards: 0, soon: false });
  });
  it('1–2 — великі картки у 2 колонки й «скоро»', () => {
    expect(cardLayout(1)).toEqual({ cards: 1, soon: true, columns: 2, visible: true });
    expect(cardLayout(2)).toEqual({ cards: 2, soon: true, columns: 2, visible: true });
  });
  it('3–5 — не більше трьох карток і «скоро» у ряду з чотирьох', () => {
    expect(cardLayout(3)).toEqual({ cards: 3, soon: true, columns: 4, visible: true });
    expect(cardLayout(5)).toEqual({ cards: 3, soon: true, columns: 4, visible: true });
  });
  it('6 і більше — до восьми карток без «скоро»', () => {
    expect(cardLayout(6)).toEqual({ cards: 6, soon: false, columns: 4, visible: true });
    expect(cardLayout(7).cards).toBe(7);
    expect(cardLayout(20)).toEqual({ cards: 8, soon: false, columns: 4, visible: true });
  });
});

describe('soonFlagIsos', () => {
  it('бере перші три країни без опису', () => {
    expect(soonFlagIsos([])).toEqual(['UA', 'DE', 'IT']);
    expect(soonFlagIsos(['UA', 'IT'])).toEqual(['DE', 'FR', 'GB']);
  });
});

describe('showDescribedCount', () => {
  it('від шести', () => {
    expect(showDescribedCount(5)).toBe(false);
    expect(showDescribedCount(6)).toBe(true);
  });
});
