/** Pure helpers of the admin first screen: slot visibility, correction change building, reason texts. */
import { describe, expect, it } from 'vitest';
import { buildChange, msToUtcInput, utcInputToMs, type EffectiveForm } from '../../src/admin/corrections';
import { reasonOf, reasonText } from '../../src/admin/messages';
import { adminSlotRegistry, visibleSlots } from '../../src/registries/adminSlots';

const base: EffectiveForm = { moment: 1_000_000, isMainCelebration: true, restrained: false, note: '', hidden: false };

describe('admin slots (AC-26, AC-28)', () => {
  it('the test slice is listed only in the test class; order is by `order`', () => {
    expect(visibleSlots('test').map((s) => s.key)).toEqual(['05-festival', '10-corrections', '15-live', '20-unattended', '30-moderation', '40-site', '50-ops', '90-test']);
    for (const cls of ['production', 'rehearsal'] as const) {
      expect(visibleSlots(cls).map((s) => s.key)).toEqual(['05-festival', '10-corrections', '15-live', '20-unattended', '30-moderation', '40-site', '50-ops']);
    }
    expect(adminSlotRegistry.filter((s) => s.testOnly).map((s) => s.key)).toEqual(['90-test']);
  });
});

describe('corrections change (AC-53)', () => {
  it('sends only what differs; nothing when equal', () => {
    expect(buildChange(base, base)).toEqual({});
    expect(buildChange(base, { ...base, moment: 2_000_000, hidden: true })).toEqual({ moment: 2_000_000, hidden: true });
    expect(buildChange(base, { ...base, restrained: true, note: 'тиша' })).toEqual({ restrained: { note: 'тиша' } });
    expect(buildChange({ ...base, restrained: true, note: 'a' }, { ...base, restrained: false, note: 'a' })).toEqual({ restrained: null });
    expect(buildChange({ ...base, restrained: true, note: 'a' }, { ...base, restrained: true, note: 'b' })).toEqual({ restrained: { note: 'b' } });
  });

  it('the UTC input round-trips and refuses other text', () => {
    const ms = utcInputToMs('2026-12-31T22:00');
    expect(ms).toBe(Date.UTC(2026, 11, 31, 22, 0));
    expect(msToUtcInput(ms as number)).toBe('2026-12-31T22:00');
    expect(utcInputToMs('2026-12-31 22:00')).toBeNull();
  });
});

describe('reason texts', () => {
  it('maps reasons to Ukrainian and never echoes unknown codes', () => {
    expect(reasonText('changed-since')).toContain('змінили');
    expect(reasonText('overlaps')).toContain('перетинається');
    expect(reasonText('<script>')).toBe('Не вдалося виконати дію.');
    expect(reasonOf({ ok: false, error: { code: 'conflict', reason: 'not-revertible' } })).toBe('not-revertible');
    expect(reasonOf({ errors: [{ message: 'x', data: { errors: [{ message: 'end-not-after-start' }] } }] })).toBe('end-not-after-start');
  });
});
