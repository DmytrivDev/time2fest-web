/**
 * Тости світу — правила смуги, ротації й привітання опівночі (рішення власника 2026-11-12, дошки `Desk-Toast-New`,
 * `Phone-Toast-New` v2).
 */
import { describe, expect, it } from 'vitest';
import {
  greetingParts,
  greetingToasters,
  keepIndex,
  nextMidnightAfter,
  pinnedUntil,
  stepIndex,
  stripView,
  type ToastRecord,
} from '@/lib/toast/feed';
import type { ToastTier } from '@/lib/toast/tiers';

const MIN = 60_000;
const M1 = Date.UTC(2026, 11, 31, 22, 0); // північ UTC+2
const M2 = Date.UTC(2026, 11, 31, 23, 0); // UTC+1
const M3 = Date.UTC(2027, 0, 1, 0, 0); // UTC+0
const MIDNIGHTS = [M1, M2, M3];

let seq = 0;
const toast = (tier: ToastTier, createdAt: number, extra: Partial<ToastRecord> = {}): ToastRecord => ({
  id: `t${++seq}`,
  nick: `Nick${seq}`,
  flagCode: 'UA',
  text: 'З Новим роком!',
  tier,
  createdAt,
  ...extra,
});

describe('закріплення до наступної півночі', () => {
  it('$5 і $10 закріплено до найближчої півночі після тосту; $2 — ні', () => {
    expect(nextMidnightAfter(M1 + 5 * MIN, MIDNIGHTS)).toBe(M2);
    expect(nextMidnightAfter(M1, MIDNIGHTS)).toBe(M2);
    expect(nextMidnightAfter(M3 + 1, MIDNIGHTS)).toBeNull();
    expect(pinnedUntil({ tier: 5, createdAt: M1 + 5 * MIN }, MIDNIGHTS)).toBe(M2);
    expect(pinnedUntil({ tier: 10, createdAt: M1 - 1 }, MIDNIGHTS)).toBe(M1);
    expect(pinnedUntil({ tier: 2, createdAt: M1 + 5 * MIN }, MIDNIGHTS)).toBeNull();
  });

  it('після тієї півночі тост уже не закріплений — він серед найновіших', () => {
    const t = toast(5, M1 + 5 * MIN);
    expect(stripView([t], M2 - 1, MIDNIGHTS).pinned).toHaveLength(1);
    const after = stripView([t], M2, MIDNIGHTS);
    expect(after.pinned).toHaveLength(0);
    expect(after.latest.map((i) => i.toast.id)).toEqual([t.id]);
  });
});

describe('порядок смуги', () => {
  it('спершу закріплені ($10, потім $5; новіші першими), далі найновіші; майбутніх не видно', () => {
    const now = M1 + 30 * MIN;
    const a = toast(5, M1 + 5 * MIN);
    const b = toast(10, M1 + 6 * MIN);
    const c = toast(2, M1 + 20 * MIN);
    const d = toast(5, M1 + 25 * MIN);
    const e = toast(2, M1 + 28 * MIN, { flagCode: 'FR' });
    const future = toast(10, now + MIN);
    const v = stripView([a, b, c, d, e, future], now, MIDNIGHTS);
    expect(v.pinned.map((i) => i.toast.id)).toEqual([b.id, d.id, a.id]);
    expect(v.pinned.every((i) => i.until === M2)).toBe(true);
    expect(v.latest.map((i) => i.toast.id)).toEqual([e.id, c.id]);
    expect(v.rotation.map((i) => i.toast.id)).toEqual([b.id, d.id, a.id, e.id, c.id]);
    expect(v.total).toBe(5);
    expect(v.countries).toBe(2);
  });

  it('найновіших у смузі — не більше ліміту', () => {
    const list = Array.from({ length: 12 }, (_, i) => toast(2, M1 + i * MIN));
    expect(stripView(list, M1 + 20 * MIN, MIDNIGHTS).latest).toHaveLength(8);
    expect(stripView(list, M1 + 20 * MIN, MIDNIGHTS, 3).rotation).toHaveLength(3);
  });

  it('порожньо — нічого не вигадуємо', () => {
    expect(stripView([], M1, MIDNIGHTS)).toEqual({ pinned: [], latest: [], rotation: [], total: 0, countries: 0 });
  });
});

describe('ротація по одному', () => {
  it('по колу вперед і назад', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it('новий тост не перебиває показаний: індекс іде за тим самим тостом; зник — та сама позиція в межах', () => {
    const a = toast(2, M1 + MIN);
    const b = toast(2, M1 + 2 * MIN);
    const before = stripView([a, b], M1 + 3 * MIN, MIDNIGHTS).rotation; // [b, a]
    expect(keepIndex(before, a.id, 1)).toBe(1);
    const c = toast(2, M1 + 3 * MIN);
    const after = stripView([a, b, c], M1 + 3 * MIN, MIDNIGHTS).rotation; // [c, b, a]
    expect(after[keepIndex(after, a.id, 1)]!.toast.id).toBe(a.id);
    expect(keepIndex(after, 'зник', 7)).toBe(2);
    expect(keepIndex([], 'x', 3)).toBe(0);
  });
});

describe('привітання опівночі', () => {
  it('ніки тих, хто сказав тост на $10 після попередньої півночі й до цієї; одна людина — один чип', () => {
    const early = toast(10, M1 - 5 * MIN, { nick: 'Рано' });
    const olena = toast(10, M1 + 5 * MIN, { nick: 'Олена', flagCode: 'UA' });
    const marie = toast(10, M1 + 7 * MIN, { nick: 'Marie', flagCode: 'FR' });
    const again = toast(10, M1 + 9 * MIN, { nick: 'олена', flagCode: 'UA' });
    const five = toast(5, M1 + 8 * MIN, { nick: 'П’ять' });
    const late = toast(10, M2 + MIN, { nick: 'Пізно' });
    const list = [late, five, again, marie, olena, early];
    expect(greetingToasters(list, M2, M1)).toEqual([
      { nick: 'Олена', flagCode: 'UA' },
      { nick: 'Marie', flagCode: 'FR' },
    ]);
    expect(greetingToasters(list, M1, null).map((t) => t.nick)).toEqual(['Рано']);
    expect(greetingToasters([five], M2, M1)).toEqual([]);
  });

  it('до 8 чипів і «і ще N»; три країни й «й ще N»', () => {
    const toasters = Array.from({ length: 12 }, (_, i) => ({ nick: `N${i}`, flagCode: 'UA' }));
    const p = greetingParts(['Франція', 'Німеччина', 'Італія', 'Іспанія', 'Польща'], toasters);
    expect(p.chips).toHaveLength(8);
    expect(p.moreToasters).toBe(4);
    expect(p.countries).toEqual(['Франція', 'Німеччина', 'Італія']);
    expect(p.moreCountries).toBe(2);
    const none = greetingParts(['Франція'], []);
    expect(none).toEqual({ countries: ['Франція'], moreCountries: 0, chips: [], moreToasters: 0 });
  });
});
