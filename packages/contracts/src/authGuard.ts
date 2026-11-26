/**
 * Zod-free, import-free guards for the auth wire (SPEC-11 P-14): used by the site bundle's http adapter.
 * Same rules as the schemas in `auth.schemas.ts` (the guards test proves they agree).
 * Return types are structural twins of the client types in `lib/api/contracts/auth.ts`.
 */
type Rec = Record<string, unknown>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isMs = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const isEmail = (x: unknown): x is string =>
  typeof x === 'string' && x.length >= 3 && x.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const SESSION_REASONS = ['signed-in', 'signed-out', 'erased', 'pass-granted', 'pass-attached', 'pass-revoked', 'email-changed'];

export interface CodeInfoLike {
  email: string;
  intent: 'signin' | 'signup';
  sentAt: number;
  resendAt: number;
  expiresAt: number;
  attemptsLeft: number;
}
export interface SessionLike {
  user: { id: string; email: string; via: 'google' | 'email'; signedInAt: number; name?: string } | null;
  guestId: string;
  hasPass: boolean;
  passOn: 'account' | 'device' | null;
  passSince: number | null;
  passNight?: string;
  devicePass: { email: string; since: number } | null;
  code: CodeInfoLike | null;
}

export function parseCodeInfo(x: unknown): CodeInfoLike | null {
  if (!isRec(x) || !onlyKeys(x, ['email', 'intent', 'sentAt', 'resendAt', 'expiresAt', 'attemptsLeft'])) return null;
  const a = x.attemptsLeft;
  if (!isEmail(x.email) || (x.intent !== 'signin' && x.intent !== 'signup')) return null;
  if (!isMs(x.sentAt) || !isMs(x.resendAt) || !isMs(x.expiresAt)) return null;
  if (!(typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 5)) return null;
  return x as unknown as CodeInfoLike;
}

function userOk(u: unknown): boolean {
  if (!isRec(u) || !onlyKeys(u, ['id', 'email', 'via', 'signedInAt', 'name'])) return false;
  return (
    isStr(u.id) &&
    isEmail(u.email) &&
    (u.via === 'google' || u.via === 'email') &&
    isMs(u.signedInAt) &&
    (u.name === undefined || typeof u.name === 'string')
  );
}

export function parseSession(x: unknown): SessionLike | null {
  if (!isRec(x) || !onlyKeys(x, ['user', 'guestId', 'hasPass', 'passOn', 'passSince', 'passNight', 'devicePass', 'code'])) return null;
  // zod requires the keys without `.optional()` to be present
  for (const k of ['user', 'guestId', 'hasPass', 'passOn', 'passSince', 'devicePass', 'code']) if (!(k in x)) return null;
  if (x.user !== null && !userOk(x.user)) return null;
  if (!isStr(x.guestId) || typeof x.hasPass !== 'boolean') return null;
  if (x.passOn !== null && x.passOn !== 'account' && x.passOn !== 'device') return null;
  if (x.passSince !== null && !isMs(x.passSince)) return null;
  if (x.passNight !== undefined && !(typeof x.passNight === 'string' && /^\d{4}-\d{2}$/.test(x.passNight))) return null;
  const d = x.devicePass;
  if (d !== null && !(isRec(d) && onlyKeys(d, ['email', 'since']) && isEmail(d.email) && isMs(d.since))) return null;
  if (x.code !== null && parseCodeInfo(x.code) === null) return null;
  return x as unknown as SessionLike;
}

export function parseSignInOutcome(x: unknown): { isNew: boolean; email: string } | null {
  if (!isRec(x) || !onlyKeys(x, ['isNew', 'email']) || typeof x.isNew !== 'boolean' || !isEmail(x.email)) return null;
  return x as unknown as { isNew: boolean; email: string };
}

export function parseGoogleRedirect(x: unknown): { kind: 'redirect'; url: string } | null {
  if (!isRec(x) || !onlyKeys(x, ['kind', 'url']) || x.kind !== 'redirect' || !isStr(x.url)) return null;
  return x as unknown as { kind: 'redirect'; url: string };
}

export function isSessionEvent(x: unknown): x is { type: 'session'; id: string; data: { reason: string } } {
  if (!isRec(x) || !onlyKeys(x, ['type', 'id', 'data']) || x.type !== 'session') return false;
  if (!(typeof x.id === 'string' && x.id.length >= 1 && x.id.length <= 64)) return false;
  const d = x.data;
  return isRec(d) && onlyKeys(d, ['reason']) && typeof d.reason === 'string' && SESSION_REASONS.includes(d.reason);
}
