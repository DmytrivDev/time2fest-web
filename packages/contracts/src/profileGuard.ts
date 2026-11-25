/**
 * Zod-free, import-free guards for the profile wire (SPEC-11 P-14). Same rules as `profile.schemas.ts`
 * (the guards test proves they agree). Return types are structural twins of `lib/api/contracts/profile.ts`.
 */
type Rec = Record<string, unknown>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isMs = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isBool = (x: unknown) => typeof x === 'boolean';
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const FLAG = /^(?:[A-Z]{2}|GB-[A-Z]{3}|[a-z]{2,8})$/;
const flagOk = (x: unknown) => typeof x === 'string' && FLAG.test(x);
const SETTING_KEYS = ['hour12', 'homeCountry', 'homeZoneId', 'showPassport', 'showPath', 'passportHints', 'quietDefault', 'reminderEmails'];
const PROFILE_KEYS = ['nick', 'flagCode', 'detectedFlag', 'settings', 'schedule', 'googleLinked', 'pendingEmail'];

export interface ProfileLike {
  nick: string | null;
  flagCode: string | null;
  detectedFlag: string | null;
  settings: {
    hour12: boolean;
    homeCountry: string | null;
    homeZoneId: string | null;
    showPassport: boolean;
    showPath: boolean;
    passportHints: boolean;
    quietDefault: boolean;
    reminderEmails: boolean;
  };
  schedule: string[];
  googleLinked: boolean;
  pendingEmail: { email: string; sentAt: number; resendAt: number; expiresAt: number; attemptsLeft: number } | null;
}

export function parseScheduleIds(x: unknown): string[] | null {
  if (!Array.isArray(x) || x.length > 512) return null;
  return x.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 128) ? (x as string[]) : null;
}

function settingsOk(s: unknown): boolean {
  if (!isRec(s) || !onlyKeys(s, SETTING_KEYS)) return false;
  if (!SETTING_KEYS.every((k) => k in s)) return false;
  const hc = s.homeCountry;
  const hz = s.homeZoneId;
  return (
    isBool(s.hour12) &&
    (hc === null || (typeof hc === 'string' && /^[A-Z]{2}$/.test(hc))) &&
    (hz === null || (typeof hz === 'string' && hz.length >= 1 && hz.length <= 32)) &&
    isBool(s.showPassport) &&
    isBool(s.showPath) &&
    isBool(s.passportHints) &&
    isBool(s.quietDefault) &&
    isBool(s.reminderEmails)
  );
}

function pendingOk(p: unknown): boolean {
  if (!isRec(p) || !onlyKeys(p, ['email', 'sentAt', 'resendAt', 'expiresAt', 'attemptsLeft'])) return false;
  const e = p.email;
  const a = p.attemptsLeft;
  return (
    typeof e === 'string' &&
    e.length >= 3 &&
    e.length <= 254 &&
    /^[^\s@]+@[^\s@]+$/.test(e) &&
    isMs(p.sentAt) &&
    isMs(p.resendAt) &&
    isMs(p.expiresAt) &&
    typeof a === 'number' &&
    Number.isInteger(a) &&
    a >= 0 &&
    a <= 5
  );
}

export function parseProfile(x: unknown): ProfileLike | null {
  if (!isRec(x) || !onlyKeys(x, PROFILE_KEYS) || !PROFILE_KEYS.every((k) => k in x)) return null;
  const n = x.nick;
  if (!(n === null || (typeof n === 'string' && n.length <= 64))) return null;
  if (!(x.flagCode === null || flagOk(x.flagCode))) return null;
  if (!(x.detectedFlag === null || flagOk(x.detectedFlag))) return null;
  if (!settingsOk(x.settings) || parseScheduleIds(x.schedule) === null || !isBool(x.googleLinked)) return null;
  if (x.pendingEmail !== null && !pendingOk(x.pendingEmail)) return null;
  return x as unknown as ProfileLike;
}

export function isProfileEvent(x: unknown): x is { type: 'profile'; id: string; data: Record<string, never> } {
  if (!isRec(x) || !onlyKeys(x, ['type', 'id', 'data']) || x.type !== 'profile') return false;
  if (!(typeof x.id === 'string' && x.id.length >= 1 && x.id.length <= 64)) return false;
  return isRec(x.data) && Object.keys(x.data).length === 0;
}
