/**
 * Realtime helpers of the integration suite (SPEC-06 AC-62): a probe of Centrifugo with the test
 * configuration, `describeRealtime` that skips (with one line naming Centrifugo) when the probe fails,
 * a Node `Centrifuge` client factory, a raw server-API helper and channel names via the registry.
 * Never prints the API key, the token secret or a token.
 */
import { Centrifuge } from 'centrifuge';
import { describe } from 'vitest';
import { channelName } from '../../src/domain/realtime/channels';
import { channelRegistry } from '../../src/registries/channels';

const PROBE_TIMEOUT_MS = 2_000;

export type ProbeResult = { ready: true } | { ready: false; message: string };

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
};

/** Centrifugo base URL, API key and channel prefix of this worktree (from `.env.local` or the shell). */
export const realtimeEnv = {
  url: env('T2F_CENTRIFUGO_URL'),
  apiKey: env('T2F_CENTRIFUGO_API_KEY'),
  prefix: env('T2F_CENTRIFUGO_PREFIX') ?? '',
};

/** The channel name of a registry class for `key` under this worktree's prefix; throws on a bad key. */
export function name(classKey: string, key?: string): string {
  const row = channelRegistry.find((r) => r.key === classKey);
  const out = row ? channelName(row, key, realtimeEnv.prefix) : undefined;
  if (out === undefined) throw new Error(`realtime: no channel for class ${classKey}`);
  return out;
}

/** Calls one Centrifugo server-API method; the response JSON (`{result}` or `{error}`) and the status. */
export async function api(
  method: string,
  body: unknown,
  { url = realtimeEnv.url, apiKey = realtimeEnv.apiKey, timeoutMs = PROBE_TIMEOUT_MS } = {},
): Promise<{ status: number; json: { result?: unknown; error?: { code: number; message?: string } } }> {
  const res = await fetch(`${url}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey ?? '' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code: number; message?: string } };
  return { status: res.status, json };
}

/**
 * Publishes into `rttest:<prefix>probe`: ready only when Centrifugo answers 200 without `error`,
 * which proves the API key and the test namespaces. The message names Centrifugo, never the key.
 */
export async function centrifugoProbe(url: string | undefined, apiKey: string | undefined, prefix: string): Promise<ProbeResult> {
  if (url === undefined) return { ready: false, message: 'Centrifugo URL (T2F_CENTRIFUGO_URL) is not set' };
  if (apiKey === undefined) return { ready: false, message: 'Centrifugo API key (T2F_CENTRIFUGO_API_KEY) is not set' };
  const row = channelRegistry.find((r) => r.key === 'rttest');
  const channel = row ? channelName(row, 'probe', prefix) : undefined;
  if (channel === undefined) return { ready: false, message: 'Centrifugo probe channel is invalid for this prefix' };
  try {
    const { status, json } = await api('publish', { channel, data: { probe: true } }, { url, apiKey });
    if (status !== 200) return { ready: false, message: `Centrifugo answered HTTP ${status}` };
    if (json.error) return { ready: false, message: `Centrifugo answered error ${json.error.code}` };
    return { ready: true };
  } catch (err) {
    const why = err instanceof Error ? err.name : 'unknown error';
    return { ready: false, message: `Centrifugo is not reachable (${why})` };
  }
}

const probe = await centrifugoProbe(realtimeEnv.url, realtimeEnv.apiKey, realtimeEnv.prefix);
let skipLogged = false;

/** `describe` that skips when Centrifugo with the test configuration is unreachable (AC-62). */
export function describeRealtime(title: string, fn: () => void): void {
  if (probe.ready) {
    describe(title, fn);
    return;
  }
  const line = `[realtime] Centrifugo with the test configuration is unreachable at ${realtimeEnv.url ?? '(unset)'}: ${probe.message} — suite skipped`;
  if (!skipLogged) {
    skipLogged = true;
    // Straight to stderr: vitest does not print console output of the collection phase.
    process.stderr.write(`${line}\n`);
  }
  describe.skip(`${title} — ${line}`, fn);
}

/** The WebSocket endpoint of Centrifugo for its base URL. */
export function websocketUrl(url: string | undefined = realtimeEnv.url): string {
  return `${(url ?? '').replace(/^http/, 'ws').replace(/\/$/, '')}/connection/websocket`;
}

/** A Node `Centrifuge` client over the global `WebSocket` (no `Origin`), not yet connected. */
export function centrifugeClient(token: string | null): Centrifuge {
  return new Centrifuge(websocketUrl(), {
    websocket: WebSocket,
    ...(token !== null ? { token } : {}),
  });
}

/** Connects `client` and resolves its state once it is `connected` or has failed; `timeoutMs` caps the wait. */
export function connectAndWait(client: Centrifuge, timeoutMs = 5_000): Promise<'connected' | 'disconnected'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(String(client.state) === 'connected' ? 'connected' : 'disconnected'), timeoutMs);
    client.once('connected', () => {
      clearTimeout(timer);
      resolve('connected');
    });
    client.once('disconnected', () => {
      clearTimeout(timer);
      resolve('disconnected');
    });
    client.connect();
  });
}
