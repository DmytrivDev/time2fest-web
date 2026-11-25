/**
 * Environment class and schema (AC-18, AC-19, AC-20). Ring 1: pure functions of the raw env
 * object passed in — this file never reads `process.env` itself.
 * Every message names variables only, never their values.
 */
import type { ZodType } from 'zod';

export type EnvClass = 'test' | 'rehearsal' | 'production';

export type RawEnv = Readonly<Record<string, string | undefined>>;

/** One environment variable of the schema. */
export interface EnvVar {
  name: string;
  /** Validates the raw value; an empty string reaches it as `undefined`. */
  schema: ZodType;
  /** Its value is masked in every log line and alarm (NFR-4). */
  secret?: true;
  /** Points at an isolated resource; checked against the production denylist (AC-20). */
  isolated?: true;
  /** Classes in which the variable must be present. */
  requiredIn?: readonly EnvClass[];
}

/** A block of variables owned by one capability; the registry is sorted by `key` (AC-62). */
export interface EnvBlock {
  key: string;
  vars: readonly EnvVar[];
}

export type LoadEnvResult =
  | {
      ok: true;
      class: EnvClass;
      env: Readonly<Record<string, unknown>>;
      secrets: string[];
      /** SPEC-13b AC-13: set when the Telegram sink must stay off although the env is valid. */
      telegramDisabledReason?: TelegramDisabledReason;
    }
  | { ok: false; failing: string[] };

/** Why the Telegram sink is off in a valid env: a `test` class pointing it off this machine (AC-13). */
export type TelegramDisabledReason = 'non-loopback';

/**
 * Identifiers of production resources (database hosts, Redis, buckets, …) that a `test` or
 * `rehearsal` class must never point at. Filled by SPEC-13a (AC-39): the production node's names
 * are fixed by convention before it exists (SPEC-13a OQ-6); matched as substrings, case-insensitively.
 */
export const PRODUCTION_DENYLIST: readonly string[] = [
  'time2fest-prod',
  'o.time2fest.com',
  't2f_production',
  't2f:production:',
];

/**
 * Production hosts a `test` or `rehearsal` class must never point at, compared as whole host names
 * (port and trailing dot dropped, case-insensitive) — `admin-rehearsal.time2fest.com` is not
 * `admin.time2fest.com` (SPEC-13a S4).
 */
export const PRODUCTION_HOSTS: readonly string[] = ['admin.time2fest.com'];

/**
 * The production names by convention (SPEC-13a OQ-6, S4): a `production` class refuses to start
 * unless its bucket contains `bucket`, its database is named `database` and its Redis prefix is
 * `redisPrefix`, so the denylist above really describes production.
 */
export const PRODUCTION_NAMES = Object.freeze({
  bucket: 'time2fest-prod',
  database: 't2f_production',
  redisPrefix: 't2f:production:',
});

/** Hosts a `test` class may point its database and Redis at. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A worktree database: `t2f_<slug>` or `t2f_<slug>_test`. */
export const WORKTREE_DATABASE = /^t2f_[a-z0-9_]+$/;

/** A worktree Redis key prefix: `t2f:<slug>:`. */
export const WORKTREE_REDIS_PREFIX = /^t2f:[a-z0-9_]+:$/;

/** A value written as `scheme://…`. */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Host name without port and trailing dot, lower-cased; `[::1]` keeps its brackets. */
function bareHost(value: string): string {
  const host = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.replace(/:\d*$/, '');
  return host.replace(/\.$/, '').toLowerCase();
}

/**
 * Whether an isolated variable's value points at production (AC-39, S4, S5): any denylist entry as a
 * substring of the raw value or — for a URL — of its percent-decoded host name and path; any
 * production host as the whole host name. A URL that does not parse or decode is refused.
 */
function pointsAtProduction(value: string, deny: readonly string[], hosts: readonly string[]): boolean {
  const texts = [value.toLowerCase()];
  let host = bareHost(value);
  if (URL_LIKE.test(value)) {
    try {
      const url = new URL(value);
      host = bareHost(decodeURIComponent(url.hostname));
      texts.push(host, decodeURIComponent(url.pathname).toLowerCase());
    } catch {
      return true;
    }
  }
  return deny.some((id) => texts.some((t) => t.includes(id))) || hosts.includes(host);
}

/** The production-class variables that break `PRODUCTION_NAMES` (S4); names only. */
export function productionNameFailures(env: Readonly<Record<string, unknown>>): string[] {
  const failing: string[] = [];
  const bucket = env.T2F_R2_BUCKET;
  if (typeof bucket !== 'string' || !bucket.includes(PRODUCTION_NAMES.bucket)) failing.push('T2F_R2_BUCKET');
  let dbName = '';
  try {
    dbName = typeof env.DATABASE_URI === 'string' ? decodeURIComponent(new URL(env.DATABASE_URI).pathname.replace(/^\//, '')) : '';
  } catch {
    dbName = '';
  }
  if (dbName !== PRODUCTION_NAMES.database) failing.push('DATABASE_URI');
  if (env.T2F_REDIS_PREFIX !== PRODUCTION_NAMES.redisPrefix) failing.push('T2F_REDIS_PREFIX');
  return failing;
}

function loopbackUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** True when the value is a URL on a loopback host (SPEC-13b: the fake Telegram base in `test`). */
export function isLoopbackUrl(value: unknown): boolean {
  return loopbackUrl(value) !== undefined;
}

/**
 * Positive allowlist of the `test` class (it may only touch this machine's worktree resources):
 * database on loopback named `t2f_…`, Redis on loopback, a `t2f:<slug>:` key prefix.
 * Returns the names of the variables that break it.
 */
export function testIsolationFailures(env: Readonly<Record<string, unknown>>): string[] {
  const failing: string[] = [];
  const db = loopbackUrl(env.DATABASE_URI);
  let dbName = '';
  try {
    dbName = db ? decodeURIComponent(db.pathname.replace(/^\//, '')) : '';
  } catch {
    dbName = '';
  }
  if (!WORKTREE_DATABASE.test(dbName)) failing.push('DATABASE_URI');
  if (!loopbackUrl(env.REDIS_URL)) failing.push('REDIS_URL');
  const prefix = env.T2F_REDIS_PREFIX;
  if (typeof prefix !== 'string' || !WORKTREE_REDIS_PREFIX.test(prefix)) failing.push('T2F_REDIS_PREFIX');
  return failing;
}

/**
 * SPEC-09 AC-48 (security S8): where an AI provider base address may point. In `test` only a loopback
 * host (the fake AI); in every other class only `https:` (the key travels in a header).
 */
function aiUrlAllowed(value: unknown, cls: EnvClass): boolean {
  if (value === undefined) return true;
  if (cls === 'test') return loopbackUrl(value) !== undefined;
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when a bare host (optionally `host:port`) is loopback: `127.0.0.1`, `localhost`, `::1`, `[::1]`. */
export function isLoopbackHost(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(v) || LOOPBACK_HOSTS.has(bareHost(v));
}

/**
 * SPEC-10 AC-47 (NFR-6): the mail hosts and the Google discovery URL may only point at this machine in `test`
 * (Mailpit, the fake SMTP, the fake OIDC); outside `test` the discovery URL is `https:` only. Names only.
 */
export function authMailFailures(env: Readonly<Record<string, unknown>>, cls: EnvClass): string[] {
  const failing: string[] = [];
  if (cls === 'test') {
    for (const name of ['SMTP_HOST', 'SMTP_FALLBACK_HOST']) {
      if (env[name] !== undefined && !isLoopbackHost(env[name])) failing.push(name);
    }
  }
  const discovery = env.T2F_GOOGLE_DISCOVERY_URL;
  if (discovery !== undefined && !aiUrlAllowed(discovery, cls)) failing.push('T2F_GOOGLE_DISCOVERY_URL');
  return failing;
}

/**
 * SPEC-13b AC-13: in `test` the Telegram base address may only be loopback (the fake). Anything else
 * switches the sink off — never a refusal, so a stray value cannot block a test stack.
 */
export function telegramDisabledReason(env: Readonly<Record<string, unknown>>, cls: EnvClass): TelegramDisabledReason | undefined {
  if (cls !== 'test' || env.T2F_TELEGRAM_API_BASE === undefined) return undefined;
  return loopbackUrl(env.T2F_TELEGRAM_API_BASE) ? undefined : 'non-loopback';
}

/** Exact match only; anything else, including unset, is the strictest class (AC-18). */
export function envClass(raw: RawEnv): EnvClass {
  const v = raw.T2F_ENV;
  return v === 'test' || v === 'rehearsal' ? v : 'production';
}

/**
 * Validates `raw` against the blocks (the caller passes `envRegistry`) and, for `test` /
 * `rehearsal`, against the production denylist and hosts; `test` must also pass
 * `testIsolationFailures`, `production` must pass `productionNameFailures`.
 * `failing` lists variable names in registry order, each once; never a value.
 */
export function loadEnv(
  raw: RawEnv,
  blocks: readonly EnvBlock[],
  denylist: readonly string[] = PRODUCTION_DENYLIST,
  productionHosts: readonly string[] = PRODUCTION_HOSTS,
): LoadEnvResult {
  const cls = envClass(raw);
  const failing: string[] = [];
  const env: Record<string, unknown> = {};
  const secrets: string[] = [];
  const deny = denylist.filter((id) => id !== '').map((id) => id.toLowerCase());
  const hosts = productionHosts.filter((h) => h !== '').map(bareHost);

  for (const block of blocks) {
    for (const v of block.vars) {
      const value = raw[v.name] === '' ? undefined : raw[v.name];
      if (v.secret && value !== undefined) secrets.push(value);

      if (value === undefined && v.requiredIn?.includes(cls)) {
        failing.push(v.name);
        continue;
      }
      const parsed = v.schema.safeParse(value);
      if (!parsed.success) {
        failing.push(v.name);
        continue;
      }
      env[v.name] = parsed.data;

      if (cls !== 'production' && v.isolated && parsed.data !== undefined) {
        if (pointsAtProduction(String(parsed.data), deny, hosts)) failing.push(v.name);
      }
    }
  }

  if (cls !== 'production' && 'PAYPRO_MODE' in env && env.PAYPRO_MODE !== 'sandbox' && !failing.includes('PAYPRO_MODE')) {
    failing.push('PAYPRO_MODE');
  }

  // Rotation (SPEC-13a AC-36): the previous edge secret must differ from the current one.
  if (
    env.T2F_EDGE_SECRET_PREVIOUS !== undefined &&
    env.T2F_EDGE_SECRET_PREVIOUS === env.T2F_EDGE_SECRET &&
    !failing.includes('T2F_EDGE_SECRET_PREVIOUS')
  ) {
    failing.push('T2F_EDGE_SECRET_PREVIOUS');
  }

  // SPEC-06 (S4): outside `test` the token HMAC key must differ from the Centrifugo API key; values never reported.
  if (
    cls !== 'test' &&
    env.T2F_CENTRIFUGO_TOKEN_SECRET !== undefined &&
    env.T2F_CENTRIFUGO_TOKEN_SECRET === env.T2F_CENTRIFUGO_API_KEY &&
    !failing.includes('T2F_CENTRIFUGO_TOKEN_SECRET')
  ) {
    failing.push('T2F_CENTRIFUGO_TOKEN_SECRET');
  }

  // SPEC-09 AC-48: in `test` an AI provider base address is loopback only; elsewhere `https:` only.
  for (const name of ['T2F_AI_ANTHROPIC_URL', 'T2F_AI_DEEPSEEK_URL']) {
    if (!aiUrlAllowed(env[name], cls) && !failing.includes(name)) failing.push(name);
  }

  for (const name of authMailFailures(env, cls)) if (!failing.includes(name)) failing.push(name);

  if (cls === 'test') {
    for (const name of testIsolationFailures(env)) if (!failing.includes(name)) failing.push(name);
  }
  if (cls === 'production') {
    for (const name of productionNameFailures(env)) if (!failing.includes(name)) failing.push(name);
  }

  const order = blocks.flatMap((b) => b.vars.map((v) => v.name));
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  failing.sort((a, b) => rank(a) - rank(b));

  if (failing.length > 0) return { ok: false, failing };
  const telegramOff = telegramDisabledReason(env, cls);
  return telegramOff ? { ok: true, class: cls, env, secrets, telegramDisabledReason: telegramOff } : { ok: true, class: cls, env, secrets };
}
