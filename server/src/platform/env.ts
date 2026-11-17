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
  | { ok: true; class: EnvClass; env: Readonly<Record<string, unknown>>; secrets: string[] }
  | { ok: false; failing: string[] };

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

  if (cls === 'test') {
    for (const name of testIsolationFailures(env)) if (!failing.includes(name)) failing.push(name);
  }
  if (cls === 'production') {
    for (const name of productionNameFailures(env)) if (!failing.includes(name)) failing.push(name);
  }

  const order = blocks.flatMap((b) => b.vars.map((v) => v.name));
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  failing.sort((a, b) => rank(a) - rank(b));

  return failing.length > 0 ? { ok: false, failing } : { ok: true, class: cls, env, secrets };
}
