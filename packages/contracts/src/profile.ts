/**
 * Profile wire vocabulary (SPEC-11). Types and constants only: zod-free, re-exported from `index.ts`.
 * The service interface stays in `lib/api/contracts/profile.ts`; the schemas are in `profile.schemas.ts`.
 */

/** `ApiError.reason` values of the profile routes that are not nick verdicts (additive). */
export const PROFILE_REASONS = ['google-taken', 'last-method', 'same-email', 'schedule-full', 'taken'] as const;
export type ProfileReason = (typeof PROFILE_REASONS)[number];

/** Keys of `ProfileSettings` accepted on the wire (unknown key → `invalid-input`). */
export const PROFILE_SETTINGS_KEYS = [
  'hour12',
  'homeCountry',
  'homeZoneId',
  'showPassport',
  'showPath',
  'passportHints',
  'quietDefault',
  'reminderEmails',
] as const;
export type ProfileSettingsKey = (typeof PROFILE_SETTINGS_KEYS)[number];

/** Special flag codes besides ISO 3166-1 alpha-2 country codes [Q5] (as on the site, `Flag.tsx`). */
export const SPECIAL_FLAG_CODES = ['earth', 'EU', 'un', 'GB-ENG', 'GB-SCT', 'GB-WLS', 'pride', 'trans', 'bisexual'] as const;
export type SpecialFlagCode = (typeof SPECIAL_FLAG_CODES)[number];

/** Event `profile` on channel `user:#<id>`: the client re-reads the profile. */
export interface ProfileEvent {
  type: 'profile';
  id: string;
  data: Record<string, never>;
}
