/**
 * Zod-free, import-free guards for the live wire (SPEC-12): used by the site bundle and the edge Worker.
 * Same rules as the schemas in `live.schemas.ts` (the test proves they agree). Return the value or `null`.
 * The return types are structural twins of the types in `live.ts` so the file needs no imports.
 */
type Rec = Record<string, unknown>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const opt = (o: Rec, k: string, f: (x: unknown) => boolean) => o[k] === undefined || f(o[k]);
const idOk = (x: unknown) => isStr(x) && x.length > 0;
const int0 = (x: unknown) => isInt(x) && x >= 0;

const SOURCE_KEYS = [
  'id', 'platform', 'videoId', 'url', 'kind', 'title', 'order', 'status', 'startsAt', 'embeddable', 'lastChecked',
  'verified', 'isLive', 'replay', 'isRecording', 'test', 'testNote', 'alwaysOn', 'sync', 'override',
];

function sourceOk(s: unknown): boolean {
  if (!isRec(s) || !onlyKeys(s, SOURCE_KEYS)) return false;
  const title = s.title;
  return (
    idOk(s.id) &&
    (s.platform === 'youtube' || s.platform === 'facebook' || s.platform === 'twitch') &&
    opt(s, 'videoId', isStr) &&
    isStr(s.url) &&
    (s.kind === 'main' || s.kind === 'webcam' || s.kind === 'tv') &&
    isRec(title) && onlyKeys(title, ['uk']) && isStr(title.uk) &&
    int0(s.order) &&
    (s.status === 'live' || s.status === 'expected' || s.status === 'possible') &&
    opt(s, 'startsAt', isStr) &&
    isBool(s.embeddable) &&
    isStr(s.lastChecked) &&
    isBool(s.verified) &&
    isBool(s.isLive) &&
    opt(s, 'replay', (r) => isRec(r) && onlyKeys(r, ['videoId', 'url']) && opt(r, 'videoId', isStr) && isStr(r.url)) &&
    opt(s, 'isRecording', isBool) &&
    opt(s, 'test', isBool) &&
    opt(s, 'testNote', isStr) &&
    opt(s, 'alwaysOn', isBool) &&
    opt(s, 'sync', (r) => isRec(r) && onlyKeys(r, ['midnightSec', 'durationSec']) && isNum(r.midnightSec) && opt(r, 'durationSec', isNum)) &&
    opt(s, 'override', isBool)
  );
}

function chainOk(c: unknown): boolean {
  return (
    isRec(c) &&
    onlyKeys(c, ['eventId', 'sources', 'version']) &&
    idOk(c.eventId) &&
    Array.isArray(c.sources) && c.sources.every(sourceOk) &&
    opt(c, 'version', int0)
  );
}

function eventOk(e: unknown): boolean {
  if (!isRec(e)) return false;
  if (e.type === 'source') return onlyKeys(e, ['type', 'eventId', 'source', 'version']) && idOk(e.eventId) && sourceOk(e.source) && int0(e.version);
  if (e.type === 'chain') return onlyKeys(e, ['type', 'chain', 'version']) && chainOk(e.chain) && int0(e.version);
  if (e.type === 'hide') return onlyKeys(e, ['type', 'eventId', 'sourceId', 'version']) && idOk(e.eventId) && idOk(e.sourceId) && int0(e.version);
  return false;
}

function viewersOk(v: unknown): boolean {
  if (!isRec(v) || !onlyKeys(v, ['countries', 'people', 'at'])) return false;
  return (
    Array.isArray(v.countries) &&
    v.countries.every((c) => isRec(c) && onlyKeys(c, ['iso', 'name', 'flagCode']) && isStr(c.iso) && isStr(c.name) && isStr(c.flagCode)) &&
    opt(v, 'people', int0) &&
    isStr(v.at)
  );
}

function chainsResponseOk(r: unknown): boolean {
  return (
    isRec(r) &&
    onlyKeys(r, ['version', 'at', 'chains']) &&
    int0(r.version) &&
    isStr(r.at) &&
    Array.isArray(r.chains) && r.chains.every(chainOk)
  );
}

/** The input on success, `null` otherwise. */
export function parseChainsResponse(x: unknown): { version: number; at: string; chains: Rec[] } | null {
  return chainsResponseOk(x) ? (x as { version: number; at: string; chains: Rec[] }) : null;
}
export function parseStreamEvent(x: unknown): Rec | null {
  return eventOk(x) ? (x as Rec) : null;
}
export function parseViewerSummary(x: unknown): { countries: Rec[]; people?: number; at: string } | null {
  return viewersOk(x) ? (x as { countries: Rec[]; people?: number; at: string }) : null;
}
