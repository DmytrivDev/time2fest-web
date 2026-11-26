/**
 * Zod-free, import-free guards for the passport wire (SPEC-14). Same rules as `passport.schemas.ts`
 * (the contracts test proves they agree). Return types are structural twins of `passport.ts`.
 */
type Rec = Record<string, unknown>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isMs = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isStr = (x: unknown, min: number, max: number) => typeof x === 'string' && x.length >= min && x.length <= max;
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const SOURCES = ['country', 'air', 'room', 'tv'];
const STAMP_KEYS = ['eventId', 'grantedAt', 'presenceSource', 'illustrationId', 'cityName', 'countryIso'];

export interface StampLike {
  eventId: string;
  grantedAt: number;
  presenceSource: 'country' | 'air' | 'room' | 'tv';
  illustrationId: string;
  cityName: string;
  countryIso: string;
}

export function isStamp(x: unknown): x is StampLike {
  return (
    isRec(x) &&
    onlyKeys(x, STAMP_KEYS) &&
    STAMP_KEYS.every((k) => k in x) &&
    isStr(x.eventId, 1, 128) &&
    isMs(x.grantedAt) &&
    typeof x.presenceSource === 'string' &&
    SOURCES.includes(x.presenceSource) &&
    isStr(x.illustrationId, 1, 128) &&
    isStr(x.cityName, 1, 128) &&
    isStr(x.countryIso, 1, 16)
  );
}

export function isStampList(x: unknown): x is StampLike[] {
  return Array.isArray(x) && x.length <= 512 && x.every(isStamp);
}

export function isStampEvent(
  x: unknown,
): x is { type: 'stamp'; id: string; data: { kind: 'granted'; stamp: StampLike } | { kind: 'snapshot'; stamps: StampLike[] } } {
  if (!isRec(x) || !onlyKeys(x, ['type', 'id', 'data']) || x.type !== 'stamp') return false;
  if (!isStr(x.id, 1, 64) || !isRec(x.data)) return false;
  const d = x.data;
  if (d.kind === 'granted') return onlyKeys(d, ['kind', 'stamp']) && isStamp(d.stamp);
  if (d.kind === 'snapshot') return onlyKeys(d, ['kind', 'stamps']) && isStampList(d.stamps);
  return false;
}

export function isBeatResponse(x: unknown): x is { nextBeatMs: number | null } {
  return isRec(x) && onlyKeys(x, ['nextBeatMs']) && 'nextBeatMs' in x && (x.nextBeatMs === null || isMs(x.nextBeatMs));
}
