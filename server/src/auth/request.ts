/**
 * Request shaping between our pipeline and Better Auth (SPEC-10 W15, [П-2]; split from `forward.ts`, A10-04):
 * - client address headers (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`) and
 *   every `x-t2f-*` header are removed; one `x-t2f-ip` is added from the edge fingerprint (`ctx.client.ipDay()`) as
 *   fd00::/8 + 120 bits of its sha256 (spike S4) — never the raw address (AC-32);
 * - the device cookie is always present (`ctx.device`), so the session hook can store it (AC-2);
 * - on a session-starting path a dead session cookie is dropped before Better Auth sees it (spike S3, #11533, AC-25).
 */
import { createHash } from 'node:crypto';
import type { Ctx } from '../endpoints/types';
import { DEVICE_COOKIE } from '../platform/device';
import { AUTH_IP_HEADER, type AuthInstance } from './instance';
import { sessionCookieName } from './response';

const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'content-length',
]);
/** Paths that start a session (sign-in, Google callback). */
export const SESSION_STARTING = /^\/(sign-in\/|callback\/google$)/;

/** `x-t2f-ip` value: fd00::/8 + the first 120 bits of sha256(fingerprint), all eight groups (spike S4). */
export function ipHeaderValue(fingerprint: string): string {
  const hash = createHash('sha256').update(fingerprint).digest();
  const bytes = Buffer.concat([Buffer.from([0xfd]), hash.subarray(0, 15)]);
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16).padStart(4, '0'));
  return groups.join(':');
}

function withCookie(header: string | null, name: string, value: string | undefined): string {
  const parts = (header ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p.slice(0, p.indexOf('=')).trim() !== name);
  if (value !== undefined) parts.push(`${name}=${value}`);
  return parts.join('; ');
}
/** The headers Better Auth sees for this request. */
export async function forwardHeaders(ctx: Ctx): Promise<Headers> {
  const headers = new Headers();
  for (const [name, value] of ctx.req.headers) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.has(lower) || lower.startsWith('x-t2f-') || lower === 'cookie') continue;
    headers.set(lower, value);
  }
  headers.set(AUTH_IP_HEADER, ipHeaderValue(await ctx.client.ipDay()));
  headers.set('cookie', withCookie(ctx.req.headers.get('cookie'), DEVICE_COOKIE, ctx.device));
  return headers;
}

export function hasCookie(headers: Headers, name: string): boolean {
  return (headers.get('cookie') ?? '').split(';').some((p) => p.trim().startsWith(`${name}=`));
}

/** S3 workaround: a session cookie that resolves to no session is removed from the forwarded request. */
export async function dropDeadSession(auth: AuthInstance, headers: Headers): Promise<void> {
  const name = await sessionCookieName(auth);
  if (!hasCookie(headers, name)) return;
  const live = await auth.api.getSession({ headers, query: { disableRefresh: true } });
  if (live === null) headers.set('cookie', withCookie(headers.get('cookie'), name, undefined));
}
