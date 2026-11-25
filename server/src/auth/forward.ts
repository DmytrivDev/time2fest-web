/**
 * The one request/response rewrite between our pipeline and Better Auth (SPEC-10 W15, [П-2]).
 * Request:
 * - client address headers (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`) and
 *   every `x-t2f-*` header are removed; one `x-t2f-ip` is added from the edge fingerprint (`ctx.client.ipDay()`) as
 *   fd00::/8 + 120 bits of its sha256 (spike S4) — never the raw address (AC-32);
 * - the device cookie is always present (`ctx.device`), so the session hook can store it (AC-2);
 * - on a session-starting path a dead session cookie is dropped before Better Auth sees it (spike S3, #11533, AC-25);
 * - the body is read once with the row's limit (4 KiB).
 * Response:
 * - JSON success → `{ ok: true, value }` without `token` / `session.token` (spike S6, AC-14, [А13]);
 * - `get-session` → the contracts `Session` with neutral pass fields (AC-35); no cookie → no Better Auth call (AC-3);
 * - a Better Auth error → `ApiError` by status (the code flow refines reasons later, W24);
 * - the session cookie's `Max-Age` / `Expires` follow `sessionExpiresAt` (AC-26).
 * Emails, codes and tokens are never logged.
 */
import { createHash } from 'node:crypto';
import type { SessionWire } from '@time2fest/contracts/schemas';
import { sessionExpiresAt } from '../domain/auth/sessionExpiry';
import { authOf } from '../endpoints/deps';
import { failure, newLogId, readBodyBytes } from '../endpoints/pipeline';
import type { Ctx, Outcome } from '../endpoints/types';
import { DEVICE_COOKIE } from '../platform/device';
import { AUTH_BASE_PATH, AUTH_IP_HEADER, authBaseUrl, type AuthInstance, type AuthWiring } from './instance';

/** Body limit of every `/api/auth/*` row. */
export const AUTH_MAX_BODY_BYTES = 4096;

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
const SESSION_STARTING = /^\/(sign-in\/|callback\/google$)/;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };

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

async function forwardHeaders(ctx: Ctx): Promise<Headers> {
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

async function sessionCookieName(auth: AuthInstance): Promise<string> {
  return (await auth.$context).authCookies.sessionToken.name;
}

function hasCookie(headers: Headers, name: string): boolean {
  return (headers.get('cookie') ?? '').split(';').some((p) => p.trim().startsWith(`${name}=`));
}

/** S3 workaround: a session cookie that resolves to no session is removed from the forwarded request. */
async function dropDeadSession(auth: AuthInstance, headers: Headers): Promise<void> {
  const name = await sessionCookieName(auth);
  if (!hasCookie(headers, name)) return;
  const live = await auth.api.getSession({ headers, query: { disableRefresh: true } });
  if (live === null) headers.set('cookie', withCookie(headers.get('cookie'), name, undefined));
}

/** Rewrites `Max-Age` / `Expires` of a non-deleting session cookie to the clamped expiry (AC-26). */
function clampSessionCookies(from: Headers, to: Headers, name: string, wiring: AuthWiring): void {
  const now = wiring.now();
  const expires = sessionExpiresAt(now, wiring.seasonEnd);
  const maxAge = Math.max(0, Math.floor((expires - now) / 1000));
  for (const line of from.getSetCookie()) {
    if (!line.startsWith(`${name}=`) || /;\s*max-age=0\b/i.test(line) || line.startsWith(`${name}=;`)) {
      to.append('set-cookie', line);
      continue;
    }
    const attrs = line
      .split(';')
      .map((p) => p.trim())
      .filter((p, i) => i === 0 || !/^(max-age|expires)=/i.test(p));
    attrs.splice(1, 0, `Max-Age=${maxAge}`, `Expires=${new Date(now + maxAge * 1000).toUTCString()}`);
    to.append('set-cookie', attrs.join('; '));
  }
}

function stripTokens(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete out.token;
  if (out.session !== null && typeof out.session === 'object') {
    const session = { ...(out.session as Record<string, unknown>) };
    delete session.token;
    out.session = session;
  }
  return out;
}

function envelope(value: unknown, status: number, cookies: Headers): Response {
  const headers = new Headers(JSON_HEADERS);
  for (const line of cookies.getSetCookie()) headers.append('set-cookie', line);
  return new Response(JSON.stringify({ ok: true, value }), { status, headers });
}

/** Better Auth error → `ApiError` by status. */
async function mapError(ctx: Ctx, res: Response): Promise<Outcome> {
  if (res.status === 429) {
    const seconds = Number(res.headers.get('x-retry-after'));
    return failure('rate_limited', Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.ceil(seconds * 1000) } : {});
  }
  if (res.status === 400 || res.status === 422) return failure('validation', { reason: 'invalid-input' });
  if (res.status === 401) return failure('unauthorized');
  if (res.status === 403) return failure('forbidden');
  if (res.status === 404) return failure('not_found');
  const logId = newLogId();
  ctx.log.error({ event: 'auth-error', route: ctx.route.key, status: res.status, logId });
  return failure('unknown', { message: logId });
}

async function fromAuthResponse(ctx: Ctx, res: Response, wiring: AuthWiring): Promise<Outcome> {
  const auth = wiring.instance();
  const cookies = new Headers();
  clampSessionCookies(res.headers, cookies, await sessionCookieName(auth), wiring);
  if (res.status >= 300 && res.status < 400) {
    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    for (const line of cookies.getSetCookie()) headers.append('set-cookie', line);
    return new Response(null, { status: res.status, headers });
  }
  if (res.status >= 400) return mapError(ctx, res);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    for (const line of cookies.getSetCookie()) headers.append('set-cookie', line);
    return new Response(res.body, { status: res.status, headers });
  }
  const text = await res.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  return envelope(stripTokens(body), res.status, cookies);
}

type BaSession = { session: { createdAt: Date | string; expiresAt: Date | string }; user: Record<string, unknown> & { id: string } };

const ms = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/** The contracts `Session` of a Better Auth session (pass fields neutral until SPEC-11). */
async function toSession(auth: AuthInstance, found: BaSession | null, device: string): Promise<SessionWire> {
  const neutral = { hasPass: false, passOn: null, passSince: null, devicePass: null, code: null } as const;
  if (found === null) return { user: null, guestId: device, ...neutral };
  const { user, session } = found;
  if (user.isAnonymous === true) return { user: null, guestId: user.id, ...neutral };
  const accounts = await (await auth.$context).internalAdapter.findAccounts(user.id);
  const via = accounts.some((a) => a.providerId === 'google') ? 'google' : 'email';
  const name = typeof user.name === 'string' && user.name.trim() !== '' ? user.name : undefined;
  return {
    user: { id: user.id, email: String(user.email), via, signedInAt: ms(session.createdAt), ...(name ? { name } : {}) },
    guestId: device,
    ...neutral,
  };
}

/**
 * `GET /api/auth/get-session`. Without a session cookie: no Better Auth call, no row (AC-3). With one: a read without
 * refresh; only when a refresh would move the clamped expiry by ≥ `updateAge` does Better Auth's own path run (one write
 * + a new cookie), so a session clamped to the season end is not rewritten on every call.
 */
async function getSession(ctx: Ctx, wiring: AuthWiring, headers: Headers): Promise<Outcome> {
  const auth = wiring.instance();
  const name = await sessionCookieName(auth);
  if (!hasCookie(headers, name)) return envelope(await toSession(auth, null, ctx.device), 200, new Headers());
  const found = (await auth.api.getSession({ headers, query: { disableRefresh: true } })) as BaSession | null;
  const due = found !== null && sessionExpiresAt(wiring.now(), wiring.seasonEnd) - ms(found.session.expiresAt) >= wiring.updateAgeMs;
  if (found !== null && !due) return envelope(await toSession(auth, found, ctx.device), 200, new Headers());
  // Dead cookie (Better Auth deletes it) or a due refresh (Better Auth writes and re-sets it).
  const res = await auth.handler(new Request(new URL(`${AUTH_BASE_PATH}/get-session`, authBaseUrl(ctx.env)), { headers }));
  if (res.status >= 400) return mapError(ctx, res);
  const cookies = new Headers();
  clampSessionCookies(res.headers, cookies, name, wiring);
  const body = (await res.json()) as BaSession | null;
  return envelope(await toSession(auth, body, ctx.device), 200, cookies);
}

/** The handler of every `/api/auth/*` row. */
export async function forwardToAuth(ctx: Ctx): Promise<Outcome> {
  const wiring = authOf(ctx.deps);
  const auth = wiring.instance();
  const headers = await forwardHeaders(ctx);
  const path = ctx.url.pathname.slice(AUTH_BASE_PATH.length);
  if (ctx.req.method === 'GET' && path === '/get-session') return getSession(ctx, wiring, headers);

  let body: string | undefined;
  if (ctx.req.method !== 'GET') {
    const bytes = await readBodyBytes(ctx.req, ctx.route.maxBodyBytes ?? AUTH_MAX_BODY_BYTES);
    if (bytes === undefined) return failure('validation', { reason: 'invalid-input' });
    body = new TextDecoder().decode(bytes);
  }
  if (SESSION_STARTING.test(path)) await dropDeadSession(auth, headers);
  const url = new URL(ctx.url.pathname + ctx.url.search, authBaseUrl(ctx.env));
  const res = await auth.handler(new Request(url, { method: ctx.req.method, headers, ...(body !== undefined && body !== '' ? { body } : {}) }));
  return fromAuthResponse(ctx, res, wiring);
}
