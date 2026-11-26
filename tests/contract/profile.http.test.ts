import { beforeAll } from 'vitest';
import { createHttpAuth, type AuthFetch } from '@/lib/api/http/auth';
import { createHttpProfile, type ProfileFetch } from '@/lib/api/http/profile';
import type { AuthService } from '@/lib/api/contracts/auth';
import type { ProfileService } from '@/lib/api/contracts/profile';
import type { RealtimeTransport } from '@/lib/api/http/realtime/types';
import { describeDomain, type ProfileSuiteCtx } from './profile.suite';
import { fullZoneOfData } from './zones';

const BASE = process.env.T2F_SERVER_URL ?? '';
const ORIGIN = process.env.T2F_HTTP_ORIGIN ?? 'http://localhost:3000';

/** Minimal cookie jar by name (one host): stores `set-cookie`, drops deleted cookies. */
class Jar {
  private readonly cookies = new Map<string, string>();
  store(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAge = attrs.map((a) => /^\s*max-age=(-?\d+)/i.exec(a)?.[1]).find((v) => v !== undefined);
      const expires = attrs.map((a) => /^\s*expires=(.+)$/i.exec(a)?.[1]).find((v) => v !== undefined);
      const gone = value === '' || (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) < Date.now());
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

interface Client {
  jar: Jar;
  auth: AuthService;
  navigated: string[];
}
const clients = new WeakMap<ProfileService, Client>();

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
let n = 0;

async function door<T>(path: string, body: unknown, jar?: Jar): Promise<{ status: number; value?: T }> {
  const cookie = jar?.header();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  jar?.store(res.headers);
  const json = (await res.json().catch(() => null)) as { value?: T } | null;
  return { status: res.status, value: json?.value };
}

function makeService(): ProfileService {
  const jar = new Jar();
  const raw = async (input: string, init: { method: string; headers?: Record<string, string>; body?: string }) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    const cookie = jar.header();
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${BASE}${input}`, { method: init.method, headers, body: init.body });
    jar.store(res.headers);
    return res;
  };
  const transport = { subscribe: () => () => {}, renewToken: async () => {} } as unknown as RealtimeTransport;
  const auth = createHttpAuth({ fetch: raw as unknown as AuthFetch, transport });
  const navigated: string[] = [];
  const svc = createHttpProfile({
    fetch: raw as unknown as ProfileFetch,
    transport: null,
    navigate: (url) => navigated.push(url),
    currentPath: () => '/account/',
  });
  clients.set(svc, { jar, auth, navigated });
  return svc;
}

const ctx: ProfileSuiteCtx = {
  freshEmail: (tag) => `t2f-http-p-${tag}-${run}-${n++}@t2f.test`,
  async signIn(svc, email) {
    const { auth } = clients.get(svc)!;
    const sent = await auth.requestCode(email, 'signup');
    if (!sent.ok) throw new Error(`requestCode → ${sent.error.code}`);
    const done = await auth.verifyCode(email, await ctx.lastCode(email));
    if (!done.ok) throw new Error(`verifyCode → ${done.error.code}`);
  },
  async lastCode(email) {
    const r = await door<{ code: string }>('/api/_test/auth/last-code', { to: email });
    if (!r.value) throw new Error(`last-code door ${r.status}`);
    return r.value.code;
  },
  async takenNick() {
    const nick = `Taken${run}${n++}`.slice(0, 20);
    const r = await door('/api/_test/rights/profile-seed', { subject: `seed-${run}-${n++}`, nick });
    if (r.status !== 200) throw new Error(`profile-seed door ${r.status}`);
    return nick;
  },
  async givePass(svc) {
    const { jar } = clients.get(svc)!;
    const r = await door('/api/_test/rights/pass-grant', { holder: { device: 'current', paymentEmail: ctx.freshEmail('pay') }, source: 'purchase', grantRef: `p-suite-${run}-${n++}` }, jar);
    if (r.status !== 200) throw new Error(`pass-grant door ${r.status}`);
  },
  fullZone: fullZoneOfData,
  async linkGoogle(svc) {
    const client = clients.get(svc)!;
    const r = await svc.linkGoogle();
    if (!r.ok) throw new Error(`linkGoogle → ${r.error.code}`);
    return client.navigated.some((u) => u.length > 0);
  },
  /**
   * SPEC-10: a NEW email from Google with `email_verified:false` → an account with an unverified address, Google its
   * only sign-in method (AC-48 `last-method`). The fake Google round trip on the service's jar (mock OIDC of the stack).
   */
  async googleOnlyAccount(svc) {
    const { jar, auth } = clients.get(svc)!;
    const started = await auth.google({ returnPath: '/account/' });
    if (!started.ok || started.value.kind !== 'redirect') throw new Error('google() did not answer a redirect');
    const authorize = new URL(started.value.url);
    const tag = `go${run}${n++}`;
    const user = await door<{ username: string; claims: string }>('/api/_test/auth/google-user', { sub: tag, email: `${tag}@t2f.test`, emailVerified: false });
    if (!user.value) throw new Error(`google-user door ${user.status}`);
    await (await fetch(authorize, { redirect: 'manual' })).text();
    const login = await fetch(authorize, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(user.value).toString(),
    });
    const location = login.headers.get('location');
    if (!location) throw new Error(`fake OIDC login answered ${login.status}`);
    const callback = new URL(location);
    const res = await fetch(`${BASE}${callback.pathname}${callback.search}`, {
      redirect: 'manual',
      headers: { origin: ORIGIN, ...(jar.header() ? { cookie: jar.header() } : {}) },
    });
    jar.store(res.headers);
    const back = new URL(res.headers.get('location') ?? '/', BASE);
    if (back.searchParams.get('signin') !== 'google') throw new Error(`google sign-in answered ${back.pathname}${back.search}`);
    const p = await svc.get();
    if (!p.ok || p.value.googleLinked !== true) throw new Error('google-only account is not linked to Google');
  },
};

beforeAll(async () => {
  const r = await door('/api/_test/reset', {});
  if (r.status !== 200) throw new Error(`reset door ${r.status}`);
}, 60_000);

describeDomain('profile (http)', makeService, ctx);
