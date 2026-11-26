/** SPEC-11 W19 — pure profile rules (AC-29, AC-33, AC-36). */
import { describe, expect, it } from 'vitest';
import { isAllowedFlag } from '../../src/domain/rights/flags';
import { nickDisplay, nickKey } from '../../src/domain/rights/nick';
import { applySettingsPatch, DEFAULT_SETTINGS, settingsOf } from '../../src/domain/rights/settings';

const refs = { countryIsos: new Set(['UA', 'PL']), zoneIds: new Set(['utc+2']) };

describe('nick key', () => {
  it('is case- and space-insensitive', () => {
    expect(nickKey('Ліра')).toBe(nickKey('  ліра '));
    expect(nickKey('A  B')).toBe(nickKey('a b'));
    expect(nickDisplay('  Ліра  ')).toBe('Ліра');
    expect(nickKey('Ліра')).not.toBe(nickKey('Лір'));
  });
});

describe('flags', () => {
  it('allows catalog ISOs and special codes only', () => {
    expect(isAllowedFlag('UA', refs.countryIsos)).toBe(true);
    expect(isAllowedFlag('pride', refs.countryIsos)).toBe(true);
    expect(isAllowedFlag('GB-ENG', refs.countryIsos)).toBe(true);
    expect(isAllowedFlag('XX', refs.countryIsos)).toBe(false);
    expect(isAllowedFlag('<b>', refs.countryIsos)).toBe(false);
  });
});

describe('settings', () => {
  it('defaults include reminderEmails false; stored partial values merge over them', () => {
    expect(DEFAULT_SETTINGS.reminderEmails).toBe(false);
    expect(settingsOf({})).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf({ hour12: true, homeCountry: 'UA', junk: 1, quietDefault: 'x' })).toEqual({ ...DEFAULT_SETTINGS, hour12: true, homeCountry: 'UA' });
  });
  it('applies a valid patch', () => {
    const r = applySettingsPatch(DEFAULT_SETTINGS, { hour12: true, homeCountry: 'PL', homeZoneId: 'utc+2', reminderEmails: true }, refs);
    expect(r).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, hour12: true, homeCountry: 'PL', homeZoneId: 'utc+2', reminderEmails: true } });
    expect(applySettingsPatch({ ...DEFAULT_SETTINGS, homeCountry: 'PL' }, { homeCountry: null }, refs)).toMatchObject({ ok: true });
  });
  it('refuses unknown keys, wrong types, unknown country or zone', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { nope: true }, refs).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { hour12: 'yes' }, refs).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { homeCountry: 'XX' }, refs).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { homeZoneId: 'utc+9' }, refs).ok).toBe(false);
  });
});
