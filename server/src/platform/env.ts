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

/** Hosts a `test` class may point its database and Redis at. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A worktree database: `t2f_<slug>` or `t2f_<slug>_test`. */
export const WORKTREE_DATABASE = /^t2f_[a-z0-9_]+$/;

/** A worktree Redis key prefix: `t2f:<slug>:`. */
export const WORKTREE_REDIS_PREFIX = /^t2f:[a-z0-9_]+:$/;

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
 * `rehearsal`, against the production denylist; `test` must also pass `testIsolationFailures`.
 * `failing` lists variable names in registry order, each once; never a value.
 */
export function loadEnv(
  raw: RawEnv,
  blocks: readonly EnvBlock[],
  denylist: readonly string[] = PRODUCTION_DENYLIST,
): LoadEnvResult {
  const cls = envClass(raw);
  const failing: string[] = [];
  const env: Record<string, unknown> = {};
  const secrets: string[] = [];
  const deny = denylist.filter((id) => id !== '').map((id) => id.toLowerCase());

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

      if (cls !== 'production' && v.isolated) {
        const text = parsed.data === undefined ? '' : String(parsed.data).toLowerCase();
        if (deny.some((id) => text.includes(id))) failing.push(v.name);
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

  const order = blocks.flatMap((b) => b.vars.map((v) => v.name));
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  failing.sort((a, b) => rank(a) - rank(b));

  return failing.length > 0 ? { ok: false, failing } : { ok: true, class: cls, env, secrets };
}
