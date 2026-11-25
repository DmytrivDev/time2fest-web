/**
 * Return path of the Google sign-in (SPEC-10 W13, AC-17, AC-18), ring 1: pure, no I/O.
 * - `safeReturnPath` keeps only a path of our own site: it must start with a single `/`; anything absolute, protocol-
 *   relative (`//`), with a backslash, a control character or an encoded separator (`%2F`, `%5C`, `%2E%2E`, also
 *   double-encoded `%25…`) becomes `/`.
 * - `withoutSignInMarks` drops the server's own params from a client path (S10-05).
 * - `withSignInMarks` adds `signin=google` (and `new=1` for a new account) to the query and keeps the `#hash`; the same
 *   shape as the site's sim `googleReturnUrl` (`lib/api/sim/auth.ts`).
 */

const MAX_PATH = 512;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const ENCODED_SEPARATOR = /%(2f|5c|2e|25)/i;

/** `raw` when it is a safe path of this site, else `/`. */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATH) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.includes('\\') || CONTROL.test(raw) || ENCODED_SEPARATOR.test(raw)) return '/';
  // The path part must not climb out with `..` segments either.
  const path = raw.split(/[?#]/, 1)[0] ?? '/';
  if (path.split('/').some((seg) => seg === '..')) return '/';
  try {
    // Must stay on the same origin once resolved (defence in depth over the checks above).
    const base = 'http://t2f.invalid';
    if (new URL(raw, base).origin !== base) return '/';
  } catch {
    return '/';
  }
  return raw;
}

/** `path` with `signin=google` (and `new=1`) added to its query, the `#hash` kept. */
export function withSignInMarks(path: string, { isNew }: { isNew: boolean }): string {
  const hashAt = path.indexOf('#');
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}signin=google${isNew ? '&new=1' : ''}${hash}`;
}

/** Query params only the server may set on a return path (S10-05): sign-in marks and the error marker. */
const SERVER_PARAMS = ['signin', 'new', 'error', 'error_description', 't2f_google'];

/** `path` (already safe) without any of the server's own query params a client may have put in it; `#hash` kept. */
export function withoutSignInMarks(path: string): string {
  const base = 'http://t2f.invalid';
  const url = new URL(path, base);
  const present = SERVER_PARAMS.filter((p) => url.searchParams.has(p));
  if (present.length === 0) return path;
  for (const p of present) url.searchParams.delete(p);
  return safeReturnPath(`${url.pathname}${url.search}${url.hash}`);
}
