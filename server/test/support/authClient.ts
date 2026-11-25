/**
 * SPEC-10 P10 integration helpers: an in-process dispatcher over this slot's stack with the edge secret set (every
 * request carries its own client address), the sign-in code captured from `sendOtp`, and a cookie-aware caller.
 * Used by `auth-guest`, `auth-events` and `auth-merge`.
 */
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createAuthWiring, type AuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import { emailKey } from '../../src/domain/auth/email';
import type { Deps } from '../../src/endpoints/types';
import type { RedisStore } from '../../src/adapters/redis';
import { BASE, ORIGIN, testDeps } from '../integration/helpers';
import { CookieJar } from './fakeOidc';

export { CookieJar };
export const SESSION_COOKIE = '__Secure-t2f.session_token';

/** A fresh client address per caller: limits key on it. */
export const freshIp = () => `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

export type Dispatch = (req: Request) => Promise<Response>;
export type CallInit = { method?: string; body?: unknown; jar?: CookieJar; ip?: string; headers?: Record<string, string> };
export type Call = (path: string, init?: CallInit) => Promise<Response>;

export function makeCall(dispatch: Dispatch, secret: string): Call {
  return async (path, init = {}) => {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    const res = await dispatch(
      new Request(BASE + path, {
        method,
        headers: {
          'x-t2f-edge': secret,
          'x-t2f-client': `${init.ip ?? freshIp()};UA`,
          ...(method === 'GET' ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
          ...(init.jar?.headers() ?? {}),
          ...(init.headers ?? {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }),
      }),
    );
    init.jar?.store(res);
    return res;
  };
}

export interface AuthHarness {
  deps: Deps;
  wiring: AuthWiring;
  dispatch: Dispatch;
  call: Call;
  /** Codes captured by address. */
  otps: Map<string, string>;
}

export async function buildAuthHarness(redis: RedisStore, prepare?: (deps: Deps) => void): Promise<AuthHarness> {
  const secret = randomBytes(20).toString('hex');
  const otps = new Map<string, string>();
  const deps = testDeps({ redis }, { T2F_EDGE_SECRET: secret });
  const wiring = createAuthWiring({
    env: deps.env,
    redis,
    sendOtp: async ({ email, otp }) => {
      otps.set(email, otp);
    },
  });
  deps.auth = wiring;
  prepare?.(deps);
  const dispatch = await buildDispatcher(deps);
  return { deps, wiring, dispatch, call: makeCall(dispatch, secret), otps };
}

/** Code sign-in of `to` with the cookies of `jar` (the 30 s gap of the address is freed first). */
export async function signIn(h: AuthHarness, redis: RedisStore, jar: CookieJar, to: string): Promise<Response> {
  const ip = freshIp();
  await redis.del(`auth:gap:${emailKey(to)}`);
  const sent = await h.call('/api/auth/email-otp/send-verification-otp', { body: { email: to, intent: 'signin' }, jar, ip });
  expect(sent.status).toBe(200);
  const otp = h.otps.get(to);
  expect(otp).toMatch(/^\d{6}$/);
  return h.call('/api/auth/sign-in/email-otp', { body: { email: to, otp }, jar, ip });
}

/** `get-session` value of `jar`. */
export async function sessionOf(h: AuthHarness, jar: CookieJar): Promise<{ user: { id: string } | null; guestId: string }> {
  const res = await h.call('/api/auth/get-session', { jar });
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: { user: { id: string } | null; guestId: string } }).value;
}

/** `POST /api/_test/auth/write-probe` (`subject: 'required'`). */
export async function writeProbe(h: AuthHarness, init: CallInit = {}): Promise<Response> {
  return h.call('/api/_test/auth/write-probe', { body: {}, ...init });
}

export async function waitFor<T>(read: () => Promise<T | undefined>, ms: number, step = 50): Promise<T | undefined> {
  const end = performance.now() + ms;
  for (;;) {
    const v = await read();
    if (v !== undefined || performance.now() >= end) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}
