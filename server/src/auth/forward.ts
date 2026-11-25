/**
 * The dispatcher of every `/api/auth/*` row (SPEC-10 W15, [П-2]): shapes the request (`request.ts`), sends it to
 * Better Auth and shapes the answer (`response.ts`).
 * - the body is read once with the row's limit (4 KiB);
 * - `get-session`: no cookie → no Better Auth call (AC-3);
 * - the code request / verify paths go through `codeFlow.ts` (validation, our limits, mail, reasons; W23, W24);
 * - `sign-in/social` goes through `google.ts` (own body, return path, errors; W33).
 * Emails, codes and tokens are never logged.
 */
import { sessionExpiresAt } from '../domain/auth/sessionExpiry';
import { authOf } from '../endpoints/deps';
import { failure, readBodyBytes } from '../endpoints/pipeline';
import type { Ctx, Outcome } from '../endpoints/types';
import { CODE_REQUEST_PATH, CODE_VERIFY_PATH, requestCode, verifyCode, type AuthCall } from './codeFlow';
import { GOOGLE_SIGN_IN_PATH, startGoogle } from './google';
import { AUTH_BASE_PATH, authBaseUrl, type AuthWiring } from './instance';
import { dropDeadSession, forwardHeaders, hasCookie, SESSION_STARTING } from './request';
import { clampSessionCookies, envelope, fromAuthResponse, mapError, ms, sessionCookieName, toSession, type BaSession } from './response';

/** Body limit of every `/api/auth/*` row. */
export const AUTH_MAX_BODY_BYTES = 4096;

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
  if (ctx.req.method === 'POST' && (path === CODE_REQUEST_PATH || path === CODE_VERIFY_PATH)) {
    // The code flow validates, limits and maps errors itself (W23, W24); Better Auth gets the normalized body.
    headers.set('content-type', 'application/json');
    const call: AuthCall = {
      send: (json) => auth.handler(new Request(url, { method: 'POST', headers, body: json })),
      respond: async (res, value) => {
        const cookies = new Headers();
        clampSessionCookies(res.headers, cookies, await sessionCookieName(auth), wiring);
        return envelope(value, 200, cookies);
      },
    };
    return path === CODE_REQUEST_PATH ? requestCode(ctx, wiring, body, call) : verifyCode(ctx, wiring, body, call);
  }
  if (ctx.req.method === 'POST' && path === GOOGLE_SIGN_IN_PATH) {
    headers.set('content-type', 'application/json');
    return startGoogle(body, {
      send: (json) => auth.handler(new Request(url, { method: 'POST', headers, body: json })),
      respond: async (res, value) => {
        const cookies = new Headers();
        clampSessionCookies(res.headers, cookies, await sessionCookieName(auth), wiring);
        return envelope(value, 200, cookies);
      },
      fail: (res) => mapError(ctx, res),
    });
  }
  const res = await auth.handler(new Request(url, { method: ctx.req.method, headers, ...(body !== undefined && body !== '' ? { body } : {}) }));
  return fromAuthResponse(ctx, res, wiring);
}
