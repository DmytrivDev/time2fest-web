/**
 * Zod-free, import-free guard for `SiteState` (SPEC-08): used by the site bundle and the edge Worker.
 * Same rules as `SiteStateSchema` in `site.schemas.ts` (the test proves they agree).
 * The return type is a structural twin of `SiteState` so the file needs no imports.
 */
type Rec = Record<string, unknown>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isBool = (x: unknown) => typeof x === 'boolean';
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const PRODUCT_KEYS = ['pass', 'toast:2', 'toast:5', 'toast:10'];
const BOOL_SWITCHES = ['chat', 'toasts', 'pass', 'passGift', 'payments', 'viewersMap', 'passOffer'];

function switchesOk(s: unknown): boolean {
  if (!isRec(s) || !onlyKeys(s, [...BOOL_SWITCHES, 'chatRooms', 'toastTiers'])) return false;
  if (!BOOL_SWITCHES.every((k) => isBool(s[k]))) return false;
  if (!isRec(s.chatRooms) || !Object.values(s.chatRooms).every(isBool)) return false;
  const t = s.toastTiers;
  return isRec(t) && onlyKeys(t, ['2', '5', '10']) && isBool(t['2']) && isBool(t['5']) && isBool(t['10']);
}

function productOk(p: unknown): boolean {
  if (!isRec(p) || !onlyKeys(p, ['key', 'price', 'priceVersion'])) return false;
  const price = p.price;
  return (
    typeof p.key === 'string' &&
    PRODUCT_KEYS.includes(p.key) &&
    isRec(price) &&
    onlyKeys(price, ['amount', 'currency']) &&
    isInt(price.amount) &&
    price.amount >= 0 &&
    price.currency === 'USD' &&
    isInt(p.priceVersion) &&
    p.priceVersion >= 1
  );
}

function patchOk(p: unknown): boolean {
  if (!isRec(p) || !onlyKeys(p, ['moment', 'isMainCelebration', 'restrained', 'hidden'])) return false;
  if (p.moment !== undefined && !(typeof p.moment === 'number' && Number.isFinite(p.moment))) return false;
  if (p.isMainCelebration !== undefined && !isBool(p.isMainCelebration)) return false;
  if (p.hidden !== undefined && !isBool(p.hidden)) return false;
  if (p.restrained !== undefined) {
    const r = p.restrained;
    if (!isRec(r) || !onlyKeys(r, ['note'])) return false;
    if (r.note !== undefined && typeof r.note !== 'string') return false;
  }
  return true;
}

/** Structural twin of `SiteState` (no imports in this file); assignable to it. */
export interface SiteStateLike {
  version: number;
  at: string;
  switches: {
    chat: boolean;
    toasts: boolean;
    pass: boolean;
    passGift: boolean;
    payments: boolean;
    viewersMap: boolean;
    passOffer: boolean;
    chatRooms: Readonly<Record<string, boolean>>;
    toastTiers: { '2': boolean; '5': boolean; '10': boolean };
  };
  products: readonly {
    key: 'pass' | 'toast:2' | 'toast:5' | 'toast:10';
    price: { amount: number; currency: 'USD' };
    priceVersion: number;
  }[];
  catalogVersion: string;
  eventPatches: Readonly<
    Record<string, { moment?: number; isMainCelebration?: boolean; restrained?: { note?: string }; hidden?: boolean }>
  >;
  outage?: 'technical';
}

/** Returns the same object when it is a valid `SiteState`, otherwise `null`. Never throws. */
export function parseSiteState(x: unknown): SiteStateLike | null {
  if (!isRec(x)) return null;
  if (!onlyKeys(x, ['version', 'at', 'switches', 'products', 'catalogVersion', 'eventPatches', 'outage'])) return null;
  if (!isInt(x.version) || x.version < 1) return null;
  if (typeof x.at !== 'string' || x.at.length === 0 || Number.isNaN(Date.parse(x.at))) return null;
  if (!switchesOk(x.switches)) return null;
  if (!Array.isArray(x.products) || !x.products.every(productOk)) return null;
  if (typeof x.catalogVersion !== 'string' || x.catalogVersion.length === 0) return null;
  if (!isRec(x.eventPatches) || !Object.values(x.eventPatches).every(patchOk)) return null;
  if (x.outage !== undefined && x.outage !== 'technical') return null;
  return x as unknown as SiteStateLike;
}
