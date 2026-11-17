/** Correction rules (AC-59, AC-61, AC-62, W35), pure. */
import { describe, expect, it } from 'vitest';
import {
  applyChange,
  changeRestoring,
  effective,
  EMPTY_PATCH,
  localTime,
  samePatch,
  toSitePatch,
  validatePatch,
  type EventBase,
} from '../../src/domain/corrections/rules';

const BASE: EventBase = {
  eventId: 'e1',
  countryIso: 'NZ',
  zoneId: 'z',
  slot: 'midnight',
  moment: Date.parse('2026-12-31T11:00:00Z'),
  isMainCelebration: true,
  offsetMinutes: 780,
};

describe('validatePatch', () => {
  it('AC-59: restrained without a note, with a blank note or with 201 characters → invalid-input', () => {
    expect(validatePatch(null, { restrained: {} }, 0)).toBe('invalid-input');
    expect(validatePatch(null, { restrained: { note: '   ' } }, 0)).toBe('invalid-input');
    expect(validatePatch(null, { restrained: { note: 'x'.repeat(201) } }, 0)).toBe('invalid-input');
  });

  it('AC-59: 200 characters and markup are accepted; the note is kept verbatim', () => {
    expect(validatePatch(null, { restrained: { note: 'x'.repeat(200) } }, 0)).toBe('ok');
    expect(validatePatch(null, { restrained: { note: '<b>x</b>' } }, 0)).toBe('ok');
    expect(applyChange(null, { restrained: { note: '<b>x</b>' } }).restrainedNote).toBe('<b>x</b>');
  });

  it('unknown keys and wrong types → invalid-input', () => {
    expect(validatePatch(null, { moment: 1.5 }, 0)).toBe('invalid-input');
    expect(validatePatch(null, { hidden: 'yes' }, 0)).toBe('invalid-input');
    expect(validatePatch(null, { title: 'x' }, 0)).toBe('invalid-input');
    expect(validatePatch(null, { restrained: { note: 'a', html: true } }, 0)).toBe('invalid-input');
    expect(validatePatch(null, ['x'], 0)).toBe('invalid-input');
    expect(validatePatch(null, { hidden: true }, -1)).toBe('invalid-input');
    expect(validatePatch(null, { hidden: true }, undefined)).toBe('invalid-input');
  });

  it('AC-61: a version older than the stored one → changed-since', () => {
    expect(validatePatch({ version: 2 }, { hidden: true }, 1)).toBe('changed-since');
    expect(validatePatch({ version: 2 }, { hidden: true }, 2)).toBe('ok');
    expect(validatePatch(null, { hidden: true }, 0)).toBe('ok');
  });
});

describe('patch state', () => {
  it('applyChange merges; null drops a field back to the base', () => {
    const one = applyChange(null, { moment: BASE.moment + 60_000, hidden: true });
    expect(one).toMatchObject({ moment: BASE.moment + 60_000, hidden: true, isMainCelebration: null });
    const two = applyChange(one, { moment: null, restrained: { note: 'n' } });
    expect(two).toMatchObject({ moment: null, hidden: true, restrained: true, restrainedNote: 'n' });
    expect(applyChange(two, { restrained: null })).toMatchObject({ restrained: false, restrainedNote: null });
  });

  it('AC-62: the wire form is SiteEventPatch; an empty patch is null', () => {
    expect(toSitePatch(EMPTY_PATCH)).toBeNull();
    expect(toSitePatch({ moment: 5, isMainCelebration: false, restrained: true, restrainedNote: 'n', hidden: true })).toEqual({
      moment: 5,
      isMainCelebration: false,
      restrained: { note: 'n' },
      hidden: true,
    });
  });

  it('changeRestoring brings any state back to the given wire patch', () => {
    const state = applyChange(null, { moment: 7, hidden: true, restrained: { note: 'q' }, isMainCelebration: false });
    expect(samePatch(applyChange(state, changeRestoring(null)), EMPTY_PATCH)).toBe(true);
    const back = applyChange(EMPTY_PATCH, changeRestoring(toSitePatch(state)));
    expect(samePatch(back, state)).toBe(true);
  });

  it('effective values: patch first, else the base', () => {
    expect(effective(BASE, null)).toEqual({ moment: BASE.moment, isMainCelebration: true, restrained: null, hidden: false });
    expect(effective(BASE, applyChange(null, { isMainCelebration: false, moment: 9 }))).toMatchObject({ moment: 9, isMainCelebration: false });
  });

  it('AC-53: local time of the zone', () => {
    expect(localTime(BASE.moment, 780)).toBe('2027-01-01 00:00');
    expect(localTime(BASE.moment, null)).toBeNull();
  });
});
