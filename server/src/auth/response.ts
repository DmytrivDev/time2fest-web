/**
 * Response shaping between Better Auth and our pipeline (SPEC-10 W15, [П-2]; split from `forward.ts`, A10-04):
 * - JSON success → `{ ok: true, value }` without `token` / `session.token` (spike S6, AC-14, [А13]);
 * - `get-session` → the contracts `Session`; pass fields from the server's pass records (SPEC-11 W12, AC-1);
 * - the Google callback's redirect goes through `google.ts` (return path, errors; W33);
 * - any other Better Auth error → `ApiError` by status (its limiter's 429 → `rate_limited/too-many`);
 * - the session cookie's `Max-Age` / `Expires` follow `sessionExpiresAt` (AC-26).
 * Emails, codes and tokens are never logged.
 */
import type { SessionWire } from '@time2fest/contracts/schemas';
import { sessionExpiresAt } from '../domain/auth/sessionExpiry';
import type { PassView } from '../domain/rights/passView';
import { failure, newLogId } from '../endpoints/pipeline';
import type { Ctx, Outcome } from '../endpoints/types';
import { GOOGLE_CALLBACK_PATH, googleCallbackLocation } from './google';
import { AUTH_BASE_PATH, authBaseUrl, type AuthInstance, type AuthWiring } from './instance';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };

export async function sessionCookieName(auth: AuthInstance): Promise<string> {
  return (await auth.$context).authCookies.sessionToken.name;
}

/** Rewrites `Max-Age` / `Expires` of a non-deleting session cookie to the clamped expiry (AC-26). */
export function clampSessionCookies(from: Headers, to: Headers, name: string, wiring: AuthWiring): void {
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

/** Our success envelope with the given Set-Cookie lines. */
export function envelope(value: unknown, status: number, cookies: Headers): Response {
  const headers = new Headers(JSON_HEADERS);
  for (const line of cookies.getSetCookie()) headers.append('set-cookie', line);
  return new Response(JSON.stringify({ ok: true, value }), { status, headers });
}

/** Better Auth error → `ApiError` by status. */
export async function mapError(ctx: Ctx, res: Response): Promise<Outcome> {
  if (res.status === 429) {
    const seconds = Number(res.headers.get('x-retry-after'));
    return failure('rate_limited', {
      reason: 'too-many',
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.ceil(seconds * 1000) } : {}),
    });
  }
  if (res.status === 400 || res.status === 422) return failure('validation', { reason: 'invalid-input' });
  if (res.status === 401) return failure('unauthorized');
  if (res.status === 403) return failure('forbidden');
  if (res.status === 404) return failure('not_found');
  const logId = newLogId();
  ctx.log.error({ event: 'auth-error', route: ctx.route.key, status: res.status, logId });
  return failure('unknown', { message: logId });
}

/** Any other Better Auth answer → our outcome (redirects, non-JSON, JSON envelope without tokens). */
export async function fromAuthResponse(ctx: Ctx, res: Response, wiring: AuthWiring): Promise<Outcome> {
  const auth = wiring.instance();
  const cookies = new Headers();
  clampSessionCookies(res.headers, cookies, await sessionCookieName(auth), wiring);
  if (res.status >= 300 && res.status < 400) {
    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    if (ctx.url.pathname === `${AUTH_BASE_PATH}${GOOGLE_CALLBACK_PATH}`) {
      headers.set('location', googleCallbackLocation(res.headers.get('location'), authBaseUrl(ctx.env), AUTH_BASE_PATH));
    }
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

export type BaSession = { session: { createdAt: Date | string; expiresAt: Date | string }; user: Record<string, unknown> & { id: string } };

export const ms = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/** The pass fields of a session (`rights/passes.ts` `view`; SPEC-11 W12). */
export type PassViewPort = { view(input: { accountId: string | null; device: string }): Promise<PassView> };

/**
 * The contracts `Session` of a Better Auth session. The pass fields come only from the server's pass records
 * (`passes.view`, FR-ID-14, AC-1); `passNight` only with a pass; `code` stays `null`.
 */
export async function toSession(auth: AuthInstance, found: BaSession | null, device: string, passes: PassViewPort): Promise<SessionWire> {
  const anonymous = found === null || found.user.isAnonymous === true;
  // The pass read and the account rows are independent reads: one round trip on the critical path, not two (NFR-1).
  const [pass, accounts] = await Promise.all([
    passes.view({ accountId: anonymous ? null : found.user.id, device }),
    anonymous ? null : auth.$context.then((c) => c.internalAdapter.findAccounts(found.user.id)),
  ]);
  const fields = { ...pass, code: null };
  if (found === null) return { user: null, guestId: device, ...fields };
  const { user, session } = found;
  if (user.isAnonymous === true || accounts === null) return { user: null, guestId: user.id, ...fields };
  const via = accounts.some((a) => a.providerId === 'google') ? 'google' : 'email';
  const name = typeof user.name === 'string' && user.name.trim() !== '' ? user.name : undefined;
  return {
    user: { id: user.id, email: String(user.email), via, signedInAt: ms(session.createdAt), ...(name ? { name } : {}) },
    guestId: device,
    ...fields,
  };
}
