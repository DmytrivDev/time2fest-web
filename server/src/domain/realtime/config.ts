/**
 * Realtime configuration and the boot refusal (SPEC-06 AC-11, AC-20). Ring 1: a pure function of the
 * raw env passed in — it never reads `process.env`. Messages name variables only, never values.
 *
 * The class-independent rules (both secrets present in `rehearsal`/`production`, at least 32
 * characters) live in the `realtime` block of the env registry. This parser adds the rest:
 * - a non-empty `T2F_CENTRIFUGO_PREFIX` must be `<slug>_` in every class (AC-11);
 * - outside `test` the prefix is always empty, so names equal the seam's §2.6 list (AC-10);
 * - `rehearsal` and `production` need `T2F_CENTRIFUGO_URL` (AC-20).
 */
import type { EnvClass, RawEnv } from '../../platform/env';
import { CHANNEL_PREFIX } from './channels';

export interface RealtimeConfig {
  /** Centrifugo base URL (HTTP API and WebSocket); absent in a `test` class without Centrifugo. */
  url?: string;
  apiKey?: string;
  tokenSecret?: string;
  /** Channel prefix `<slug>_` in `test`; `''` everywhere else. */
  prefix: string;
}

export type RealtimeConfigResult = { ok: true; config: RealtimeConfig } | { ok: false; failing: string[] };

const value = (raw: RawEnv, name: string): string | undefined => {
  const v = raw[name];
  return v === undefined || v === '' ? undefined : v;
};

/** Validates and assembles the realtime settings for `cls`; `failing` names each variable once. */
export function parseRealtimeConfig(raw: RawEnv, cls: EnvClass): RealtimeConfigResult {
  const failing: string[] = [];

  const url = value(raw, 'T2F_CENTRIFUGO_URL');
  if (cls !== 'test' && url === undefined) failing.push('T2F_CENTRIFUGO_URL');

  const prefixRaw = value(raw, 'T2F_CENTRIFUGO_PREFIX');
  if (prefixRaw !== undefined && !CHANNEL_PREFIX.test(prefixRaw)) failing.push('T2F_CENTRIFUGO_PREFIX');

  if (failing.length > 0) return { ok: false, failing };

  const config: RealtimeConfig = { prefix: cls === 'test' ? (prefixRaw ?? '') : '' };
  const apiKey = value(raw, 'T2F_CENTRIFUGO_API_KEY');
  const tokenSecret = value(raw, 'T2F_CENTRIFUGO_TOKEN_SECRET');
  if (url !== undefined) config.url = url;
  if (apiKey !== undefined) config.apiKey = apiKey;
  if (tokenSecret !== undefined) config.tokenSecret = tokenSecret;
  return { ok: true, config };
}
