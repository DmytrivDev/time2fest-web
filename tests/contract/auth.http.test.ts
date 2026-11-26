import { beforeAll, describe, expect, it } from 'vitest';
import { createHttpAuth, type AuthFetch } from '@/lib/api/http/auth';
import type { RealtimeTransport } from '@/lib/api/http/realtime/types';
import type { AuthService } from '@/lib/api/contracts/auth';
import { describeDomain, type AuthSuiteCtx } from './auth.suite';

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

const jars = new WeakMap<AuthService, Jar>();
const renewals = new WeakMap<AuthService, { n: number }>();

async function door<T>(path: string, body: unknown): Promise<{ status: number; value?: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; value?: T } | null;
  return { status: res.status, value: json?.value };
}

/** A door call carrying the cookies of `svc` (its device/session); the answer's cookies go back into the jar. */
async function doorAs(svc: AuthService, path: string, body: unknown): Promise<{ status: number; value?: unknown }> {
  const jar = jars.get(svc)!;
  const cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  jar.store(res.headers);
  const json = (await res.json().catch(() => null)) as { value?: unknown } | null;
  return { status: res.status, value: json?.value };
}

let grants = 0;

function makeService(): AuthService {
  const jar = new Jar();
  const spy = { n: 0 };
  const fetchWithJar: AuthFetch = async (input, init) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const cookie = jar.header();
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${BASE}${input}`, { method: init.method, headers, body: init.body });
    jar.store(res.headers);
    return res;
  };
  const transport: RealtimeTransport = {
    subscribe: () => () => {},
    renewToken: async () => {
      spy.n += 1;
    },
  } as unknown as RealtimeTransport;
  const svc = createHttpAuth({ fetch: fetchWithJar, transport });
  jars.set(svc, jar);
  renewals.set(svc, spy);
  return svc;
}

let n = 0;
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** The fake Google round trip of this worktree's stack (mock OIDC on 127.0.0.1:8091), through the service's cookie jar. */
async function google(svc: AuthService, scenario: 'ok' | 'cancel'): Promise<{ signedIn: boolean; cancelled: boolean }> {
  const jar = jars.get(svc)!;
  const started = await svc.google({ returnPath: '/countries/ua' });
  if (!started.ok || started.value.kind !== 'redirect') throw new Error('google() did not answer a redirect');
  const authorize = new URL(started.value.url);
  let callback: URL;
  if (scenario === 'cancel') {
    callback = new URL('/api/auth/callback/google', BASE);
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  } else {
    const tag = `g${run}${n++}`;
    const user = await door<{ username: string; claims: string }>('/api/_test/auth/google-user', {
      sub: tag,
      email: `${tag}@t2f.test`,
      emailVerified: true,
    });
    if (!user.value) throw new Error(`google-user door ${user.status}`);
    const page = await fetch(authorize, { redirect: 'manual' });
    await page.text();
    const login = await fetch(authorize, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(user.value).toString(),
    });
    const location = login.headers.get('location');
    if (!location) throw new Error(`fake OIDC login answered ${login.status}`);
    callback = new URL(location);
  }
  const res = await fetch(`${BASE}${callback.pathname}${callback.search}`, {
    redirect: 'manual',
    headers: { origin: ORIGIN, ...(jar.header() ? { cookie: jar.header() } : {}) },
  });
  jar.store(res.headers);
  const back = new URL(res.headers.get('location') ?? '/', BASE);
  await svc.session();
  return { signedIn: back.searchParams.get('signin') === 'google', cancelled: back.searchParams.get('error') === 'cancelled' };
}

const ctx: AuthSuiteCtx = {
  freshEmail: (tag) => `t2f-http-${tag}-${run}-${n++}@t2f.test`,
  async lastCode(email) {
    const r = await door<{ code: string }>('/api/_test/auth/last-code', { to: email });
    if (!r.value) throw new Error(`last-code door ${r.status}`);
    return r.value.code;
  },
  async expireCode(email) {
    const r = await door('/api/_test/auth/expire-code', { email });
    if (r.status !== 200) throw new Error(`expire-code door ${r.status}`);
  },
  async freeGap(email) {
    const r = await door('/api/_test/auth/free-gap', { email });
    if (r.status !== 200) throw new Error(`free-gap door ${r.status}`);
  },
  async breakDelivery() {
    const r = await door('/api/_test/mail/break-delivery', {});
    if (r.status !== 200) throw new Error(`break-delivery door ${r.status}`);
  },
  google,
  async grantDevicePass(svc, email) {
    const r = await doorAs(svc, '/api/_test/rights/pass-grant', {
      holder: { device: 'current', paymentEmail: email },
      source: 'purchase',
      grantRef: `http-suite-${run}-${grants++}`,
    });
    if (r.status !== 200) throw new Error(`pass-grant door ${r.status}`);
  },
  async grantAccountPass(svc) {
    const s = await svc.session();
    if (!s.ok || !s.value.user) throw new Error('grantAccountPass: not signed in');
    const r = await doorAs(svc, '/api/_test/rights/pass-grant', {
      holder: { account: s.value.user.id },
      source: 'purchase',
      grantRef: `http-suite-${run}-${grants++}`,
    });
    if (r.status !== 200) throw new Error(`pass-grant door ${r.status}`);
  },
  async signInOtherDevice(_owner, other, email) {
    const sent = await other.requestCode(email, 'signin');
    if (!sent.ok) throw new Error(`requestCode → ${sent.error.code}`);
    const done = await other.verifyCode(email, await ctx.lastCode(email));
    if (!done.ok) throw new Error(`verifyCode → ${done.error.code}`);
  },
};

beforeAll(async () => {
  const r = await door('/api/_test/reset', {});
  if (r.status !== 200) throw new Error(`reset door ${r.status}`);
}, 60_000);

describeDomain('auth (http)', makeService, ctx);

describe('auth (http): realtime token renewal', () => {
  it('renewToken runs once after the code sign-in and once after sign-out', async () => {
    const svc = makeService();
    const email = ctx.freshEmail('renew');
    expect((await svc.requestCode(email, 'signup')).ok).toBe(true);
    expect((await svc.verifyCode(email, await ctx.lastCode(email))).ok).toBe(true);
    expect(renewals.get(svc)!.n).toBe(1);
    expect((await svc.signOut()).ok).toBe(true);
    expect(renewals.get(svc)!.n).toBe(2);
  });
});
