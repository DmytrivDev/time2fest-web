/**
 * The Better Auth instance of the process (SPEC-10 W15, [П-1] … [П-4]). Better Auth is imported only under
 * `server/src/auth/**` (onion); the rest of the server reaches it through `Deps.auth` (`authOf`).
 * - Built lazily on first use (no connection, no timer in `createDeps`); own `pg.Pool` (max 5) on `DATABASE_URI`.
 * - Schema-relevant options come from `authStaticOptions` (P4), spread first, so the tables always match.
 * - Cookies: prefix `t2f`, always `Secure` (`__Secure-t2f.session_token`), `HttpOnly; SameSite=Lax; Path=/`, no
 *   `Domain`; cookie cache off ([А6]). Session 60 days, refreshed after 1 day, clamped to the season end (AC-26).
 * - IP: only `x-t2f-ip`, set by `forward.ts` from the edge fingerprint (S4: fd00::/8 + 120 bits of sha256, so the
 *   whole /128 is the key). Sessions store no IP and a user-agent of ≤128 characters (NFR-5).
 * - Origin check stays on (never `disableOriginCheck` / `disableCSRFCheck`); `trustedOrigins` = `T2F_ALLOWED_ORIGINS`.
 * - Google only when the discovery URL, client id and client secret are all set.
 * Secrets are never logged.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { realClock } from '../clock';
import { sessionExpiresAt } from '../domain/auth/sessionExpiry';
import type { AppEnv } from '../endpoints/types';
import { DEVICE_COOKIE, isDeviceId, readCookie } from '../platform/device';
import type { FastStore } from '../ports';
import { CODE_REQUEST_PATH, CODE_VERIFY_PATH, markUserCreated, sendSignInCode } from './codeFlow';
import { authStaticOptions, type AuthStaticInput } from './options';

export const AUTH_BASE_PATH = '/api/auth';
export const AUTH_IP_HEADER = 'x-t2f-ip';
const SESSION_EXPIRES_IN_S = 60 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_S = 24 * 60 * 60;
const USER_AGENT_MAX = 128;
const DEFAULT_SERVER_PORT = 4200;
const GOOGLE_PLUGIN_ID = 'generic-oauth';

export interface AuthInput {
  env: AppEnv;
  /** Rate-limit counters of Better Auth's own limiter. */
  redis: FastStore;
  /** Delivers a sign-in code; default `sendSignInCode` (the mail service of the request's deps, W23). */
  sendOtp?: AuthStaticInput['sendOtp'];
  /** Wall clock in epoch ms for the session clamp ([П-9]); default `realClock`. */
  now?: () => number;
}

/**
 * Better Auth's built-in limiter stays only as a safety net under our code limits ([А4], W22/W23): its defaults
 * (`/sign-in/*` 3 per 10 s, email-otp 3 per 60 s per address) would refuse before ours on a shared address, so the two
 * code paths get 20 per 60 s.
 */
const CODE_PATH_SAFETY_NET = { window: 60, max: 20 };

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function allowedOrigins(env: AppEnv): string[] {
  const list = env.vars.T2F_ALLOWED_ORIGINS;
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string') : [];
}

/** `baseURL`: the loopback server in `test`, else the first allowed origin (loopback when none). */
export function authBaseUrl(env: AppEnv): string {
  const raw = Number(env.vars.T2F_SERVER_PORT);
  const port = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_SERVER_PORT;
  const loopback = `http://127.0.0.1:${port}`;
  if (env.class === 'test') return loopback;
  return allowedOrigins(env)[0] ?? loopback;
}

/** The season end in epoch ms (`T2F_SEASON_END`, default 2027-01-15). */
export function seasonEndOf(env: AppEnv): number {
  const raw = str(env.vars.T2F_SEASON_END) ?? '2027-01-15T00:00:00Z';
  return Date.parse(raw);
}

function cookieOf(ctx: { headers?: Headers; request?: Request } | null | undefined): string | undefined {
  return ctx?.headers?.get('cookie') ?? ctx?.request?.headers.get('cookie') ?? undefined;
}

function buildAuth(input: AuthInput) {
  const { env, redis } = input;
  const now = input.now ?? (() => realClock.now());
  const seasonEnd = seasonEndOf(env);
  const google = {
    discoveryUrl: str(env.vars.T2F_GOOGLE_DISCOVERY_URL),
    clientId: str(env.vars.T2F_GOOGLE_CLIENT_ID),
    clientSecret: str(env.vars.T2F_GOOGLE_CLIENT_SECRET),
  };
  const googleOn = google.discoveryUrl !== undefined && google.clientId !== undefined && google.clientSecret !== undefined;
  const statics = authStaticOptions({
    sendOtp: input.sendOtp ?? sendSignInCode,
    googleDiscoveryUrl: google.discoveryUrl ?? 'http://127.0.0.1:9/unused',
    googleClientId: google.clientId ?? 'unused',
    googleClientSecret: google.clientSecret ?? 'unused',
  });
  // A test process without the secret gets a random one (sessions then live as long as the process).
  const secret = str(env.vars.T2F_AUTH_SECRET) ?? (env.class === 'test' ? randomBytes(32).toString('hex') : undefined);
  if (secret === undefined) throw new Error('env: invalid T2F_AUTH_SECRET');
  const clamp = () => new Date(sessionExpiresAt(now(), seasonEnd));

  return betterAuth({
    ...statics,
    plugins: googleOn ? statics.plugins : statics.plugins.filter((p) => p.id !== GOOGLE_PLUGIN_ID),
    database: new pg.Pool({ connectionString: String(env.vars.DATABASE_URI ?? ''), max: 5 }),
    basePath: AUTH_BASE_PATH,
    baseURL: authBaseUrl(env),
    secret,
    trustedOrigins: allowedOrigins(env),
    session: {
      ...statics.session,
      expiresIn: SESSION_EXPIRES_IN_S,
      updateAge: SESSION_UPDATE_AGE_S,
      cookieCache: { enabled: false },
    },
    advanced: {
      ...statics.advanced,
      cookiePrefix: 't2f',
      useSecureCookies: true,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: true, path: '/' },
      ipAddress: { ipAddressHeaders: [AUTH_IP_HEADER], ipv6Subnet: 128 },
    },
    rateLimit: {
      enabled: true,
      customRules: {
        [CODE_REQUEST_PATH]: CODE_PATH_SAFETY_NET,
        [CODE_VERIFY_PATH]: CODE_PATH_SAFETY_NET,
      },
      customStorage: {
        // One atomic counter per key and window (FastStore `incrWindow`); the key holds the hashed address only.
        async consume(key: string, rule: { window: number; max: number }) {
          const { count, ttlMs } = await redis.incrWindow(`auth:rl:${key}`, rule.window * 1000);
          if (count <= rule.max) return { allowed: true, retryAfter: null };
          return { allowed: false, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)) };
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // `SignInOutcome.isNew` of the verify request that created the user (W24).
          async after() {
            markUserCreated();
          },
        },
      },
      session: {
        create: {
          async before(session, ctx) {
            const device = readCookie(cookieOf(ctx), DEVICE_COOKIE);
            return {
              data: {
                ...session,
                ipAddress: '',
                userAgent: typeof session.userAgent === 'string' ? session.userAgent.slice(0, USER_AGENT_MAX) : '',
                deviceId: isDeviceId(device) ? device : null,
                expiresAt: clamp(),
              },
            };
          },
        },
        update: {
          async before(session) {
            if (session.expiresAt === undefined) return;
            return { data: { ...session, expiresAt: clamp() } };
          },
        },
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof buildAuth>;

/** What the server keeps of sign-in: the lazy instance and the session rules the forwarder needs. */
export interface AuthWiring {
  /** The Better Auth instance, built on first call. */
  instance(): AuthInstance;
  /** Season end in epoch ms. */
  readonly seasonEnd: number;
  /** Wall clock in epoch ms. */
  now(): number;
  /** Session refresh age in ms (Better Auth `updateAge`). */
  readonly updateAgeMs: number;
}

export function createAuthWiring(input: AuthInput): AuthWiring {
  let built: AuthInstance | undefined;
  return {
    instance: () => (built ??= buildAuth(input)),
    seasonEnd: seasonEndOf(input.env),
    now: input.now ?? (() => realClock.now()),
    updateAgeMs: SESSION_UPDATE_AGE_S * 1000,
  };
}
