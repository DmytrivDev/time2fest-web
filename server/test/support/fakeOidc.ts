/**
 * Fake Google sign-in for server tests (SPEC-10 W4): drives the interactive login form of the compose service `oidc`
 * (`ghcr.io/navikt/mock-oauth2-server:7.0.2`, issuer `http://127.0.0.1:8091/google`, fakes/oidc/README.md) and a tiny
 * cookie jar for Node `fetch` / `auth.handler` round trips. Never reaches accounts.google.com.
 *
 * Login form (spike S5): `POST <authorize URL>` urlencoded `username=<sub>&claims=<JSON>`; the JSON is merged into the
 * id_token (`email`, `email_verified`, `name`, …) and `sub` = `username`. The answer is a 302 to our redirect URI with
 * `code` and `state`.
 */

export const FAKE_OIDC_ISSUER = 'http://127.0.0.1:8091/google';
export const FAKE_OIDC_DISCOVERY = `${FAKE_OIDC_ISSUER}/.well-known/openid-configuration`;

/** A made-up Google user for the mock's login form. */
export interface FakeGoogleUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** The exact form fields the mock's login page posts. */
export function fakeGoogleForm(user: FakeGoogleUser): { username: string; claims: string } {
  const claims: Record<string, unknown> = { sub: user.sub, email: user.email, email_verified: user.emailVerified };
  if (user.name !== undefined) claims.name = user.name;
  return { username: user.sub, claims: JSON.stringify(claims) };
}

/**
 * Follows the mock's authorize URL, posts the login form and returns the redirect `Location` (our callback with
 * `code` and `state`). Throws when the mock does not redirect.
 */
export async function fakeGoogleLogin(authorizeUrl: string, user: FakeGoogleUser): Promise<string> {
  const page = await fetch(authorizeUrl, { redirect: 'manual' });
  if (page.status !== 200) throw new Error(`fake OIDC authorize page answered ${page.status}`);
  await page.text();
  const res = await fetch(authorizeUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fakeGoogleForm(user)).toString(),
  });
  const location = res.headers.get('location');
  if (res.status < 300 || res.status >= 400 || !location) throw new Error(`fake OIDC login answered ${res.status} without a redirect`);
  return location;
}

/** The callback a user who pressed «cancel» at Google lands on. */
export function fakeGoogleCancel(callbackBase: string, state: string): string {
  const u = new URL('/api/auth/callback/google', callbackBase);
  u.searchParams.set('error', 'access_denied');
  u.searchParams.set('state', state);
  return u.toString();
}

/** Minimal cookie jar keyed by name (one host per test): stores `set-cookie`, drops deleted cookies. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Applies every `set-cookie` of a response (`Max-Age<=0` or an expiry in the past deletes). */
  store(res: Response | Headers): this {
    const headers = res instanceof Headers ? res : res.headers;
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (isDeletion(value, attrs)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): this {
    this.cookies.set(name, value);
    return this;
  }

  delete(name: string): this {
    this.cookies.delete(name);
    return this;
  }

  /** `cookie` request header, or `undefined` when empty. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Request headers with the jar's cookies added. */
  headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = this.header();
    return cookie ? { ...extra, cookie } : { ...extra };
  }
}

function isDeletion(value: string, attrs: string[]): boolean {
  if (value === '') return true;
  for (const raw of attrs) {
    const [k = '', v = ''] = raw.split('=').map((s) => s.trim());
    const key = k.toLowerCase();
    if (key === 'max-age' && Number(v) <= 0) return true;
    if (key === 'expires' && Date.parse(v) <= Date.now()) return true;
  }
  return false;
}
