/**
 * Google sign-in (SPEC-10 W33; AC-17 … AC-23, [А12]). Google is the `generic-oauth` provider `google` (fake OIDC in
 * tests); the browser only ever sees two of our paths:
 * - `POST /api/auth/sign-in/social` `{ returnPath }` (`googleBody`, strict): the return path is cut to a path of our own
 *   site (`safeReturnPath`, anything else → `/`, AC-18); Better Auth gets a body WE build — provider `google`, success
 *   URLs with `signin=google` (+ `new=1` for a new account), an error URL marked with `t2f_google=error`, no redirect —
 *   so a caller can never pass an `idToken`, a foreign callback URL or a link request. Answer: `{kind:'redirect', url}`
 *   (the Google authorize URL) with the state cookie. Discovery down (provider not built) → `unavailable` (AC-22).
 * - `GET /api/auth/callback/google`: Better Auth checks state, PKCE, nonce and the id_token against the discovered JWKS
 *   and issuer; its redirect is rewritten here: our error mark → the return path with `error=cancelled` (Google's
 *   `access_denied`, AC-19) or `error=failed` (anything else, incl. `account_not_linked` of an unverified email,
 *   AC-21, spike S2); Better Auth's own error page or any foreign target → `/?error=failed`; success → the stored path,
 *   re-checked. The `#hash` is kept (AC-17).
 * Linking ([А12], AC-20, AC-21): no trusted providers, so an existing account is linked only when Google says
 * `email_verified=true` (Better Auth's default rule; `email_verified` is read from the verified id_token — spike S2, no
 * `mapProfileToUser`); the account's name is not overwritten. Sign-in still links only by the SAME email (Better Auth
 * finds the user by the Google address); `allowDifferentEmails: true` (SPEC-11 [Q1]) affects only the explicit link
 * from the cabinet (`link.ts`, `POST /api/me/google`).
 * Explicit link (SPEC-11 W32, AC-46): `googleLinkBody` builds Better Auth's `/link-social` body with its own marks —
 * success `t2f_google=linked`, error `t2f_google=link-error`; the callback maps them: linked → the return path (mark
 * dropped), `account_already_linked_to_different_user` → `error=google-taken`, `access_denied` → `error=cancelled`,
 * anything else → `error=failed`.
 */
import { googleBody } from '@time2fest/contracts/schemas';
import { safeReturnPath, withoutSignInMarks, withSignInMarks } from '../domain/auth/returnPath';
import { failure } from '../endpoints/pipeline';
import type { Outcome } from '../endpoints/types';

export const GOOGLE_PROVIDER_ID = 'google';
export const GOOGLE_SIGN_IN_PATH = '/sign-in/social';
export const GOOGLE_CALLBACK_PATH = '/callback/google';
/** Marks Better Auth's error redirect so it can be told from a successful one. */
const ERROR_MARK = 't2f_google';
const FAILED_HOME = '/?error=failed';
const LINKED = 'linked';
const LINK_ERROR = 'link-error';
/** Better Auth's core link path (genericOAuth registers Google as a social provider). */
export const GOOGLE_LINK_PATH = '/link-social';

/** `account.accountLinking` of the instance ([А12]). */
export const GOOGLE_ACCOUNT_LINKING = {
  enabled: true,
  trustedProviders: [] as string[],
  allowDifferentEmails: true,
  updateUserInfoOnLink: false,
};

/** `path` with `name=value` added to its query, the `#hash` kept. */
function withParam(path: string, name: string, value: string): string {
  const hashAt = path.indexOf('#');
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}${name}=${value}${hash}`;
}

/** The Better Auth body of `sign-in/social` for a raw request body, or `undefined` when the body is invalid. */
export function googleSignInBody(body: string | undefined): string | undefined {
  let raw: unknown;
  try {
    raw = body === undefined || body === '' ? undefined : JSON.parse(body);
  } catch {
    return undefined;
  }
  const parsed = googleBody.safeParse(raw);
  if (!parsed.success) return undefined;
  // A client-supplied `signin` / `new` / `error` / `t2f_google` is dropped: only the server sets them (S10-05).
  const path = withoutSignInMarks(safeReturnPath(parsed.data.returnPath));
  return JSON.stringify({
    provider: GOOGLE_PROVIDER_ID,
    callbackURL: withSignInMarks(path, { isNew: false }),
    newUserCallbackURL: withSignInMarks(path, { isNew: true }),
    errorCallbackURL: withParam(path, ERROR_MARK, 'error'),
    disableRedirect: true,
  });
}

/** The return path of a link: a path of our own site without the server's marks. */
export function linkReturnPath(returnPath: string): string {
  return withoutSignInMarks(safeReturnPath(returnPath));
}

/** The Better Auth body of `/link-social` for a return path (already a string; cut to our own site here). */
export function googleLinkBody(returnPath: string): string {
  const path = linkReturnPath(returnPath);
  return JSON.stringify({
    provider: GOOGLE_PROVIDER_ID,
    callbackURL: withParam(path, ERROR_MARK, LINKED),
    errorCallbackURL: withParam(path, ERROR_MARK, LINK_ERROR),
    disableRedirect: true,
  });
}

/** The reason a failed link shows on the return path. */
function linkErrorReason(code: string | null): string {
  if (code === 'account_already_linked_to_different_user') return 'google-taken';
  if (code === 'access_denied') return 'cancelled';
  return 'failed';
}

async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** How the flow reaches Better Auth (same shape as the code flow's `AuthCall`). */
export interface GoogleCall {
  send(body: string): Promise<Response>;
  respond(res: Response, value: unknown): Promise<Outcome>;
  /** Maps any other Better Auth error by status. */
  fail(res: Response): Promise<Outcome>;
}

/** `POST /api/auth/sign-in/social`. */
export async function startGoogle(body: string | undefined, call: GoogleCall): Promise<Outcome> {
  const json = googleSignInBody(body);
  if (json === undefined) return failure('validation', { reason: 'invalid-input' });
  const res = await call.send(json);
  if (res.status === 404 && (await errorCodeOf(res.clone())) === 'PROVIDER_NOT_FOUND') {
    // Google off, or its discovery document unreachable (Better Auth retried it with a 10 s timeout): AC-22.
    return failure('unavailable');
  }
  if (res.status >= 400) return call.fail(res);
  const value = (await res.json()) as { url?: unknown } | null;
  const url = typeof value?.url === 'string' ? value.url : undefined;
  if (url === undefined) return failure('unavailable');
  return call.respond(res, { kind: 'redirect', url });
}

/**
 * The `Location` our callback answers with, from Better Auth's. `base` = the auth base URL (`authBaseUrl`).
 * Never leaves our own site: a foreign or unparsable target becomes `/?error=failed`.
 */
export function googleCallbackLocation(location: string | null, base: string, authBasePath: string): string {
  if (location === null || location === '') return FAILED_HOME;
  let url: URL;
  let origin: string;
  try {
    origin = new URL(base).origin;
    url = new URL(location, origin);
  } catch {
    return FAILED_HOME;
  }
  if (url.origin !== origin) return FAILED_HOME;
  // A form_post callback is re-sent to itself as a GET by Better Auth.
  if (url.pathname === `${authBasePath}${GOOGLE_CALLBACK_PATH}`) return url.pathname + url.search;
  const mark = url.searchParams.get(ERROR_MARK);
  if (mark === LINKED) {
    url.searchParams.delete(ERROR_MARK);
    return safeReturnPath(url.pathname + url.search + url.hash);
  }
  if (mark === 'error' || mark === LINK_ERROR) {
    const code = url.searchParams.get('error');
    const reason = mark === LINK_ERROR ? linkErrorReason(code) : code === 'access_denied' ? 'cancelled' : 'failed';
    url.searchParams.delete(ERROR_MARK);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.append('error', reason);
    const back = url.pathname + url.search + url.hash;
    return safeReturnPath(back) === back ? back : `/?error=${reason}`;
  }
  // Better Auth's own error page (state lost, bad request) — never shown to a visitor.
  if (url.pathname === authBasePath || url.pathname.startsWith(`${authBasePath}/`)) return FAILED_HOME;
  return safeReturnPath(url.pathname + url.search + url.hash);
}
