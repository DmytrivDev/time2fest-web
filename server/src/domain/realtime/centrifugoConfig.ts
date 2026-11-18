/**
 * Centrifugo v6 configuration generated from the channel registry (SPEC-06 AC-2 … AC-8, AC-21 static
 * half). Ring 1: pure — the rows, the class and the site origins come in; a plain object and its env
 * rendering go out. No clock, no I/O, never a secret and never an engine address.
 *
 * Every key below is a Centrifugo v6.10.3 JSON key (`internal/configtypes/types.go`, `namespace.go`,
 * `internal/config/config.go`). An unknown key is silently ignored by Centrifugo, so nothing here is
 * spelled from memory.
 *
 * Deny by default: no namespace and no channel without a namespace ever gets `allow_publish_for_*`,
 * `allow_history_for_*` or `allow_presence_for_*` (AC-3, AC-21). Personal channels are reachable only
 * through the `#` user limit; anonymous clients subscribe only to public classes (AC-7).
 */
import type { EnvClass } from '../../platform/env';
import type { ChannelClassRow } from './channels';

/** Server-to-client ping interval (AC-5; 25–50 s behind Cloudflare). */
export const CENTRIFUGO_PING_INTERVAL = '25s';

/** Meta TTL of personal history streams (AC-8: ≤3 600 s). */
export const PERSONAL_HISTORY_META_TTL_SECONDS = 3600;

/** Origins a `test` connection may come from: loopback on any slot port (AC-6, glob-matched). */
/**
 * The internal port of rehearsal and production (S1): the server HTTP API (`/api/*`) and `/health` are
 * served only there, never on the public client port the tunnel exposes. Centrifugo v6.10.3 keys
 * `http_server.internal_port` (a string in its schema) with `http_api.external` left at its default `false`.
 * The server's `T2F_CENTRIFUGO_URL` points at this port inside the network.
 */
export const CENTRIFUGO_INTERNAL_PORT = '9000';

export const TEST_ALLOWED_ORIGINS: readonly string[] = ['http://127.0.0.1:*', 'http://localhost:*'];

/** Options shared by a namespace and the channels without one (Centrifugo `ChannelOptions`). */
export interface CentrifugoChannelOptions {
  allow_subscribe_for_anonymous?: boolean;
  allow_subscribe_for_client?: boolean;
  allow_user_limited_channels?: boolean;
  force_recovery: boolean;
  history_meta_ttl?: string;
  history_size: number;
  history_ttl: string;
}

export interface CentrifugoNamespace extends CentrifugoChannelOptions {
  name: string;
}

export interface CentrifugoConfig {
  channel: {
    namespaces: CentrifugoNamespace[];
    without_namespace?: CentrifugoChannelOptions;
  };
  client: {
    allow_anonymous_connect_without_token: boolean;
    allowed_origins: string[];
    disallow_anonymous_connection_tokens: boolean;
    ping_interval: string;
  };
  health: { enabled: boolean };
  /** Rehearsal and production only: API and health on the internal port (S1). */
  http_server?: { internal_port: string };
}

/** Whether `config` serves the API and health on an internal port apart from the public one (S1). */
export function hasInternalSplit(config: CentrifugoConfig): boolean {
  return typeof config.http_server?.internal_port === 'string' && config.http_server.internal_port !== '';
}

const seconds = (n: number): string => `${n}s`;

/**
 * The options of one namespace (or of the channels without one) from its rows. Centrifugo keeps
 * history per namespace, not per channel, so the rows' maximum size and maximum TTL win (Spec
 * follow-up 1): `live` = `live:streams` 10 / 300 s over `live:viewers` 1 / 120 s → 10 / 300 s.
 */
function channelOptions(rows: readonly ChannelClassRow[], label: string): CentrifugoChannelOptions {
  const visibility = rows[0]?.visibility;
  if (visibility === undefined) throw new Error(`centrifugoConfig: ${label} has no rows`);
  if (rows.some((r) => r.visibility !== visibility)) {
    throw new Error(`centrifugoConfig: ${label} mixes public and personal rows`);
  }
  const historySize = Math.max(...rows.map((r) => r.history.size));
  const historyTtl = Math.max(...rows.map((r) => r.history.ttlSeconds));
  return visibility === 'public' ? publicOptions(historySize, historyTtl) : personalOptions(historySize, historyTtl);
}

function publicOptions(size: number, ttlSeconds: number): CentrifugoChannelOptions {
  return {
    allow_subscribe_for_anonymous: true,
    allow_subscribe_for_client: true,
    force_recovery: true,
    history_size: size,
    history_ttl: seconds(ttlSeconds),
  };
}

/**
 * A personal namespace: subscription only to `<ns>:…#<own user id>` through the user limit; no
 * anonymous subscribe. `allow_subscribe_for_client` is deliberately absent (deny by default): it is
 * added only if the permissions suite (W28) shows the `#` channels need it — AC-24 must pass while
 * AC-22/AC-23 still refuse. W28 records here which way it went.
 */
function personalOptions(size: number, ttlSeconds: number): CentrifugoChannelOptions {
  return {
    allow_user_limited_channels: true,
    force_recovery: true,
    history_meta_ttl: seconds(PERSONAL_HISTORY_META_TTL_SECONDS),
    history_size: size,
    history_ttl: seconds(ttlSeconds),
  };
}

/**
 * The Centrifugo configuration of `cls`. `rows` are the channel classes (`channelClassesFor(cls)`);
 * test-only rows are dropped outside `test` here as well, so `rttest` can never reach rehearsal or
 * production (AC-4). `siteOrigins` is the site origin per deployed class (AC-6).
 */
export function centrifugoConfig(
  rows: readonly ChannelClassRow[],
  cls: EnvClass,
  siteOrigins: Readonly<Record<'rehearsal' | 'production', string>>,
): CentrifugoConfig {
  const classRows = cls === 'test' ? rows : rows.filter((r) => r.testOnly !== true);

  const byNamespace = new Map<string, ChannelClassRow[]>();
  const withoutNamespace: ChannelClassRow[] = [];
  for (const row of classRows) {
    if (row.namespace === null) {
      withoutNamespace.push(row);
    } else {
      const list = byNamespace.get(row.namespace) ?? [];
      list.push(row);
      byNamespace.set(row.namespace, list);
    }
  }

  const namespaces: CentrifugoNamespace[] = [...byNamespace.keys()]
    .sort()
    .map((name) => ({ name, ...channelOptions(byNamespace.get(name) ?? [], `namespace ${name}`) }));

  const channel: CentrifugoConfig['channel'] = { namespaces };
  if (withoutNamespace.length > 0) channel.without_namespace = channelOptions(withoutNamespace, 'without_namespace');

  return {
    channel,
    client: {
      allow_anonymous_connect_without_token: true,
      allowed_origins: cls === 'test' ? [...TEST_ALLOWED_ORIGINS] : [siteOrigins[cls]],
      disallow_anonymous_connection_tokens: true,
      ping_interval: CENTRIFUGO_PING_INTERVAL,
    },
    health: { enabled: true },
    // `test` (local stand and CI, bound to loopback) stays single-port, so the shared container and the
    // stack files need no change; rehearsal and production split API and health onto the internal port.
    ...(cls === 'test' ? {} : { http_server: { internal_port: CENTRIFUGO_INTERNAL_PORT } }),
  };
}

/**
 * The env rendering of `config` (the local and CI Centrifugo is env-only): `CENTRIFUGO_` + the key path
 * upper-cased with `.` → `_`; string arrays space-separated; `channel.namespaces` as one JSON string.
 * Sorted by variable name, so the output is deterministic.
 */
export function centrifugoEnv(config: CentrifugoConfig): [string, string][] {
  const out: [string, string][] = [];
  const walk = (path: string[], node: unknown): void => {
    const name = `CENTRIFUGO_${path.join('_').toUpperCase()}`;
    if (path.join('.') === 'channel.namespaces') {
      out.push([name, JSON.stringify(node)]);
    } else if (Array.isArray(node)) {
      out.push([name, node.map(String).join(' ')]);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) walk([...path, key], child);
    } else if (node !== undefined) {
      out.push([name, String(node)]);
    }
  };
  walk([], config);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
