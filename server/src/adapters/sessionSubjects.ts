/**
 * The production `SubjectResolver` (SPEC-10 W28, AC-30; SPEC-06 C5): the subject of a request is the user of its
 * Better Auth session cookie — `account`, or `guest` for an anonymous user — with the user id (a uuid, which matches
 * `SUBJECT_ID`). No session cookie → `null` with no database read (AC-3). The read never refreshes the session.
 * Also the guest start of `25-subject` ([П-6], spike S8): `auth.api.signInAnonymous` with the request's device cookie,
 * so the guest is bound to the device (AC-4); its session cookie gets the clamped expiry like any other (AC-26).
 */
import { clampSessionCookies, sessionCookieName } from '../auth/response';
import type { AuthWiring } from '../auth/instance';
import { SUBJECT_ID } from '../domain/realtime/channels';
import type { RealtimeSubject, SubjectResolver } from '../realtime/ports';

/** Every Better Auth session cookie name ends with this (`__Secure-t2f.session_token`). */
const SESSION_COOKIE_SUFFIX = 'session_token=';

function hasCookie(header: string, name: string): boolean {
  return header.split(';').some((p) => p.trim().startsWith(`${name}=`));
}

/** The subject of the session cookie in `headers`, or `null`. */
export async function sessionSubjectOf(wiring: AuthWiring, headers: Headers): Promise<RealtimeSubject | null> {
  const cookie = headers.get('cookie') ?? '';
  // Cheap pre-check: a request without any session cookie never builds or reads Better Auth.
  if (!cookie.includes(SESSION_COOKIE_SUFFIX)) return null;
  const auth = wiring.instance();
  if (!hasCookie(cookie, await sessionCookieName(auth))) return null;
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
