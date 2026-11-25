/** SPEC-11 W19 — profile settings: defaults and a strict patch (AC-36). Pure. */
import type { ProfileSettingsWire } from '@time2fest/contracts/schemas';

/** Defaults as `stores/account.ts`; `reminderEmails` is on by default [Q2]. */
export const DEFAULT_SETTINGS: Readonly<ProfileSettingsWire> = {
  hour12: false,
  homeCountry: null,
  homeZoneId: null,
  showPassport: true,
  showPath: true,
  passportHints: true,
  quietDefault: false,
  reminderEmails: true,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof ProfileSettingsWire)[];

export interface SettingsRefs {
  countryIsos: ReadonlySet<string>;
  zoneIds: ReadonlySet<string>;
}

export type SettingsResult = { ok: true; value: ProfileSettingsWire } | { ok: false };

/** Stored `settings` (possibly `{}` or partial) over the defaults; unknown or ill-typed keys are dropped. */
export function settingsOf(stored: unknown): ProfileSettingsWire {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (stored !== null && typeof stored === 'object') {
    for (const k of KEYS) {
      const v = (stored as Record<string, unknown>)[k];
      if (k === 'homeCountry' || k === 'homeZoneId') {
        if (v === null || typeof v === 'string') out[k] = v;
      } else if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out as unknown as ProfileSettingsWire;
}

/** `current` with `patch` applied; an unknown key, a wrong type, an unknown country or zone → `{ok:false}`. */
export function applySettingsPatch(current: ProfileSettingsWire, patch: Record<string, unknown>, refs: SettingsRefs): SettingsResult {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(KEYS as string[]).includes(k)) return { ok: false };
    if (v === undefined) continue;
    if (k === 'homeCountry') {
      if (v !== null && (typeof v !== 'string' || !refs.countryIsos.has(v))) return { ok: false };
    } else if (k === 'homeZoneId') {
      if (v !== null && (typeof v !== 'string' || !refs.zoneIds.has(v))) return { ok: false };
    } else if (typeof v !== 'boolean') return { ok: false };
    next[k] = v;
  }
  return { ok: true, value: next as unknown as ProfileSettingsWire };
}
