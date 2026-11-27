/**
 * The production `SubjectResolver` (SPEC-10 W28, AC-30; SPEC-06 C5): the subject of a request is the user of its
 * Better Auth session cookie — `account`, or `guest` for an anonymous user — with the user id (a uuid, which matches
 * `SUBJECT_ID`). No session cookie → `null` with no database read (AC-3). The read never refreshes the session.
 * Also the guest start of `25-subject` ([П-6], spike S8): `auth.api.signInAnonymous` with the request's device cookie,
 * so the guest is bound to the device (AC-4); its session cookie gets the clamped expiry like any other (AC-26).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authPool } from '../auth/pool';
import { clampSessionCookies, sessionCookieName } from '../auth/response';
import type { AuthWiring } from '../auth/instance';
import { realClock } from '../clock';
import { SUBJECT_ID } from '../domain/realtime/channels';
import type { RealtimeSubject, SubjectResolver } from '../realtime/ports';

/** Every Better Auth session cookie name ends with this (`__Secure-t2f.session_token`). */
const SESSION_COOKIE_SUFFIX = 'session_token=';

function hasCookie(header: string, name: string): boolean {
  return header.split(';').some((p) => p.trim().startsWith(`${name}=`));
}

/** The raw value of the cookie `name` in a `Cookie` header; `undefined` when absent or sent more than once. */
function cookieValue(header: string, name: string): string | undefined {
  let found: string | undefined;
  for (const part of header.split(';')) {
    const p = part.trim();
    if (!p.startsWith(`${name}=`)) continue;
    // Duplicates: leave the choice to Better Auth's own cookie parser.
    if (found !== undefined) return undefined;
    found = p.slice(name.length + 1);
  }
  return found;
}

/**
 * The longest cookie value the fast path verifies (S14-04): a Better Auth token is 32 chars, the signature 44, so a
 * URI-encoded value is well under 128; anything longer goes to Better Auth without being decoded or hashed here.
 */
export const SIGNED_COOKIE_MAX = 512;

/** The session token of a signed cookie value (better-call's `<token>.<base64 HMAC-SHA256>`), or `null`. */
export function verifiedToken(raw: string, secret: string): string | null {
  if (raw.length > SIGNED_COOKIE_MAX) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (signature.length !== 44 || !signature.endsWith('=')) return null;
  const want = createHmac('sha256', secret).update(token).digest();
  const got = Buffer.from(signature, 'base64');
  return got.length === want.length && timingSafeEqual(got, want) ? token : null;
}

interface SessionRow extends Record<string, unknown> {
  id: string;
  is_anonymous: boolean | null;
  expires_at: Date;
}

/**
 * The fast path of the subject read (SPEC-14 NFR-1/NFR-2: Better Auth's `getSession` was about a quarter of a beat's
 * CPU): the signed cookie is verified here and the live session is read with one indexed join, every request — so a
 * revoked or deleted session stops at once (SPEC-10 AC-27). Only the plain case is answered here: a valid signature
 * and a live, unexpired session. Anything else (`undefined`) goes through Better Auth, which also clears an expired
 * session exactly as before.
 */
async function fastSessionOf(wiring: AuthWiring, raw: string): Promise<RealtimeSubject | undefined> {
  const auth = wiring.instance();
  const token = verifiedToken(raw, (await auth.$context).secret);
  if (token === null) return undefined;
  const pool = await authPool({ auth: wiring });
  const res = await pool.query<SessionRow>(
    `SELECT u.id::text AS id, u.is_anonymous, s.expires_at FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token],
  );
  const row = res.rows[0];
  // Session expiry is wall time on purpose: Better Auth compares it with the wall clock too (`expiresAt < new Date()`),
  // so the virtual test clock must not change which path answers.
  if (row === undefined || !(row.expires_at instanceof Date) || row.expires_at.getTime() < realClock.now()) {
    return undefined;
  }
  if (!SUBJECT_ID.test(row.id)) return undefined;
  return { kind: row.is_anonymous === true ? 'guest' : 'account', id: row.id };
}

/**
 * The answer of the fast path for `headers`: `null` (no session cookie: no subject, nothing read), the subject (a
 * valid signature and a live session), or `undefined` — Better Auth must decide. Exported for the equivalence test
 * against `auth.api.getSession` (`session-subjects-equivalence.int`).
 */
export async function fastSubjectOf(wiring: AuthWiring, headers: Headers): Promise<RealtimeSubject | null | undefined> {
  const cookie = headers.get('cookie') ?? '';
  // Cheap pre-check: a request without any session cookie never builds or reads Better Auth.
  if (!cookie.includes(SESSION_COOKIE_SUFFIX)) return null;
  const name = await sessionCookieName(wiring.instance());
  if (!hasCookie(cookie, name)) return null;
  const raw = cookieValue(cookie, name);
  return raw !== undefined && raw !== '' ? fastSessionOf(wiring, raw) : undefined;
}

/** The subject of the session cookie in `headers`, or `null`. */
export async function sessionSubjectOf(wiring: AuthWiring, headers: Headers): Promise<RealtimeSubject | null> {
  const fast = await fastSubjectOf(wiring, headers);
  if (fast !== undefined) return fast;
  const auth = wiring.instance();
  const found = await auth.api.getSession({ headers, query: { disableRefresh: true } });
  if (found === null) return null;
  const id = found.user.id;
  if (!SUBJECT_ID.test(id)) return null;
  return { kind: (found.user as { isAnonymous?: unknown }).isAnonymous === true ? 'guest' : 'account', id };
}

/** `SubjectResolver` over the auth wiring of the deps (read lazily: tests replace `deps.auth` after `createDeps`). */
export function createSessionSubjects(auth: () => AuthWiring | undefined): SubjectResolver {
  return {
    async resolve(req) {
      const wiring = auth();
      return wiring === undefined ? null : sessionSubjectOf(wiring, req.headers);
    },
  };
}

export interface GuestSession {
  /** The guest's subject id. */
  id: string;
  /** `Set-Cookie` lines of the guest session (expiry clamped). */
  cookies: string[];
}

/**
 * Creates a guest with a session. `headers` carry only the device cookie, the client IP header and the user agent —
 * never a (possibly dead) session cookie (spike S3).
 */
export async function startGuestSession(wiring: AuthWiring, headers: Headers): Promise<GuestSession> {
  const auth = wiring.instance();
  const { headers: out, response } = await auth.api.signInAnonymous({ headers, returnHeaders: true });
  const id = response?.user.id;
  if (typeof id !== 'string' || !SUBJECT_ID.test(id)) throw new Error('auth: guest not created');
  const cookies = new Headers();
  clampSessionCookies(out, cookies, await sessionCookieName(auth), wiring);
  return { id, cookies: cookies.getSetCookie() };
}
