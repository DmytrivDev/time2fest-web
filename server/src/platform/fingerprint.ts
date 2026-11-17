/**
 * Daily client fingerprint (ring 3, AC-24 … AC-27, NFR-5): an HMAC-SHA-256 of the client network
 * (an IPv4 address, or the /64 of an IPv6 one) keyed by a random salt of the current UTC day.
 * The salt is shared through the `FastStore` port ("create if absent", TTL until the next UTC
 * midnight); when the store is down, a per-instance memory salt of that day is used and never
 * written anywhere. Nothing here logs. Depends on `ports.ts` and `node:*` only (onion ban 2).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { DependencyUnavailable, type Clock, type FastStore } from '../ports';

const DAY_MS = 86_400_000;
const SALT_BYTES = 32;

/** The UTC day of `ms`, `YYYY-MM-DD`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The eight 16-bit groups of a valid IPv6 address, or `undefined`. */
function ipv6Groups(ip: string): number[] | undefined {
  let text = ip.split('%')[0] as string;
  // A dotted IPv4 tail (`::ffff:1.2.3.4`) becomes the last two hex groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2, 6).map(Number) as [number, number, number, number];
    text = `${dotted[1] as string}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const head = parse(halves[0] as string);
  const rest = halves.length === 2 ? parse(halves[1] as string) : [];
  const fill = 8 - head.length - rest.length;
  const groups = halves.length === 2 ? [...head, ...new Array<number>(Math.max(fill, 0)).fill(0), ...rest] : head;
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return undefined;
  return groups;
}

/**
 * The network a client is counted by: IPv4 as is; an IPv4-mapped IPv6 address → its IPv4;
 * any other IPv6 → `xxxx:xxxx:xxxx:xxxx::/64` of its expanded form. `undefined` for anything
 * that is not an IP address.
 */
export function networkOf(ip: string): string | undefined {
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return undefined;
  const groups = ipv6Groups(ip.toLowerCase());
  if (!groups) return undefined;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6] as number;
    const lo = groups[7] as number;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  const prefix = groups.slice(0, 4).map((g) => g.toString(16).padStart(4, '0'));
  return `${prefix.join(':')}::/64`;
}

/** Hex HMAC-SHA-256 of `network` under `salt`; contains no part of the address. */
export function fingerprintOf(network: string, salt: string): string {
  return createHmac('sha256', salt).update(network).digest('hex');
}

export interface DaySalts {
  /** The salt of the current UTC day. Never throws on a store outage (AC-27). */
  saltFor(): Promise<string>;
}

export interface DaySaltsDeps {
  fast: FastStore;
  clock: Clock;
  random?: (size: number) => Buffer;
}

/** Milliseconds from `ms` to the next UTC midnight, clamped to [1, 86 400 000]. */
function ttlToMidnight(ms: number): number {
  // Epoch milliseconds have no leap seconds: every UTC day starts at a multiple of DAY_MS.
  const next = (Math.floor(ms / DAY_MS) + 1) * DAY_MS;
  return Math.min(DAY_MS, Math.max(1, next - ms));
}

/**
 * Salts of the UTC day. The salt read from the store is cached per instance while the day is
 * unchanged (NFR-5); on `DependencyUnavailable` the instance's memory salt of the day is used and
 * not cached as the store salt, so the next request retries the store. A day change drops both.
 */
export function daySalts({ fast, clock, random = randomBytes }: DaySaltsDeps): DaySalts {
  let shared: { day: string; salt: string } | undefined;
  let local: { day: string; salt: string } | undefined;

  const localSalt = (day: string): string => {
    if (local?.day !== day) local = { day, salt: random(SALT_BYTES).toString('base64') };
    return local.salt;
  };

  return {
    async saltFor() {
      const now = clock.now();
      const day = utcDay(now);
      if (shared?.day === day) return shared.salt;
      shared = undefined;
      if (local !== undefined && local.day !== day) local = undefined;
      const key = `edge:salt:${day}`;
      try {
        let salt = await fast.get(key);
        if (salt === null) {
          await fast.setIfAbsent(key, random(SALT_BYTES).toString('base64'), ttlToMidnight(now));
          salt = await fast.get(key);
        }
        if (salt === null) return localSalt(day);
        shared = { day, salt };
        return salt;
      } catch (err) {
        if (!(err instanceof DependencyUnavailable)) throw err;
        return localSalt(day);
      }
    },
  };
}
