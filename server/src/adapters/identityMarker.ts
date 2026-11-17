/**
 * Identity marker (ring 4): the gate signs who passed it into the request header
 * `x-t2f-access-identity`; the second check inside Payload verifies it (AC-5).
 * HMAC-SHA256 over `kind|subject|exp` with a 32-byte key generated once per process on
 * `globalThis` — the proxy and the route handlers of one process share it; nothing outside the
 * process can forge it. Value: `<base64url(json)>.<base64url(mac)>`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccessIdentity, IdentityMarker } from '../access/ports';
import type { Clock } from '../ports';

export const IDENTITY_HEADER = 'x-t2f-access-identity';

const KEY = Symbol.for('t2f.identityMarkerKey');

function processKey(): Buffer {
  const g = globalThis as unknown as Record<symbol, Buffer | undefined>;
  return (g[KEY] ??= randomBytes(32));
}

const mac = (key: Buffer, id: AccessIdentity): Buffer =>
  createHmac('sha256', key).update(`${id.kind}|${id.subject}|${id.exp}`).digest();

function parse(json: string): AccessIdentity | null {
  try {
    const v = JSON.parse(json) as Partial<AccessIdentity>;
    if ((v.kind === 'person' || v.kind === 'service') && typeof v.subject === 'string' && typeof v.exp === 'number') {
      return { kind: v.kind, subject: v.subject, exp: v.exp };
    }
  } catch {
    /* malformed */
  }
  return null;
}

/**
 * An identity past its `exp` no longer verifies. `clock` is real time (the JWT `exp` it mirrors is
 * checked by jose against real time too).
 */
export function createIdentityMarker(clock: Clock, key: Buffer = processKey()): IdentityMarker {
  const now = () => Math.floor(clock.now() / 1000);
  return {
    sign(id) {
      const body = Buffer.from(JSON.stringify({ kind: id.kind, subject: id.subject, exp: id.exp })).toString('base64url');
      return `${body}.${mac(key, id).toString('base64url')}`;
    },
    verify(value) {
      if (typeof value !== 'string') return null;
      const [body, sig, extra] = value.split('.');
      if (body === undefined || sig === undefined || extra !== undefined) return null;
      const id = parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!id) return null;
      const expected = mac(key, id);
      const given = Buffer.from(sig, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      return id.exp > now() ? id : null;
    },
  };
}
