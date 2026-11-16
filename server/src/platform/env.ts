/**
 * Environment class and schema (AC-18, AC-19, AC-20). Ring 1: pure functions of the raw env
 * object passed in — this file never reads `process.env` itself.
 * Every message names variables only, never their values.
 */
import type { ZodType } from 'zod';
import { envRegistry } from '../registries/env';

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
 * `rehearsal` class must never point at. Empty until the production resources exist:
 * spec SPEC-02 Open question 1 — SPEC-13a fills it.
 */
export const PRODUCTION_DENYLIST: readonly string[] = [];

/** Exact match only; anything else, including unset, is the strictest class (AC-18). */
export function envClass(raw: RawEnv): EnvClass {
  const v = raw.T2F_ENV;
  return v === 'test' || v === 'rehearsal' ? v : 'production';
}

/**
 * Validates `raw` against the blocks and, for `test` / `rehearsal`, against the isolation guard.
 * `failing` lists variable names in registry order, each once.
 */
export function loadEnv(
  raw: RawEnv,
  blocks: readonly EnvBlock[] = envRegistry,
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

  return failing.length > 0 ? { ok: false, failing } : { ok: true, class: cls, env, secrets };
}
