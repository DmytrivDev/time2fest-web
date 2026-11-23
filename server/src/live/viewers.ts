/**
 * The viewers aggregator (SPEC-12 AC-59 … AC-63, [П-1], [П-5]), ring 3. Reads the presence of `live:viewers`
 * (only each entry's `chan_info`, never a client id), folds it with the pure `aggregateViewers` and keeps the result
 * in process memory only: nothing is written to the database, the journal, R2 or a log, so a restarted process
 * starts from zero (AC-63).
 *
 *  - `tick` (the background ticker, every `VIEWERS_PASS_MS`): only the `live-viewers` lease holder reads presence
 *    and publishes the current summary on `live:viewers` — one event per pass, so events come every 30 s (AC-60).
 *  - `current` (the `GET` route, any instance): answers from the in-memory pass, re-reading presence on demand at
 *    most once per `VIEWERS_PASS_MS`.
 *
 * `issueViewerToken` signs the subscription token of the lock-holder tab ([П-2]): `info` is `{p: 1}` plus `c` — the
 * Cloudflare IP country of the token request — only when it is a real country (AC-59). The token, the country and
 * the address are never logged.
 *
 * The cached pass is switch-free; the switches (`viewersMap`, `viewersCount`) are applied on every answer and every
 * publish, so a toggle shows on the next read (AC-62).
 */
import { fail, LIVE_VIEWERS_CLASS, ok, type ApiResult, type RealtimeTokenValue, type SiteSwitches, type ViewerSummary } from '@time2fest/contracts';
import type { LiveConfig } from '../domain/live/config';
import { MS_PER_SECOND } from '../domain/realtime/token';
import { aggregateViewers, viewerCatalogOrder, viewerCountry, type ViewerCatalogCountry } from '../domain/live/viewers';
import type { Clock } from '../ports';
import type { ChannelPublisher, SubscriptionSigner } from '../realtime/ports';
import type { LiveLease, PresenceSource } from './ports';

export const LIVE_VIEWERS_LEASE = 'live-viewers';
/** One pass every 30 s, inside the [30, 60] s of AC-60. */
export const VIEWERS_PASS_MS = 30_000;
const LEASE_TTL_MS = 3 * VIEWERS_PASS_MS;
/** The catalog order changes only with a catalog import: re-read every 5 minutes. */
const CATALOG_TTL_MS = 5 * 60_000;
/** The realtime event type of a summary on `live:viewers`. */
export const VIEWERS_EVENT_TYPE = 'viewers';

const ALL_ON = { viewersMap: true, viewersCount: true } as const;

export interface ViewersDeps {
  presence: PresenceSource;
  /** The channel name of `live:viewers` (with the worktree prefix in `test`). */
  channel: string;
  lease: LiveLease;
  /** Absent in a process without the realtime API: the holder then only refreshes its cache. */
  publisher?: ChannelPublisher;
  switches: () => Promise<Pick<SiteSwitches, 'viewersMap' | 'viewersCount'>>;
  /** The catalog countries (any order). */
  countries: () => Promise<ViewerCatalogCountry[]>;
  cfg: LiveConfig;
  clock: Clock;
}

export type ViewersRead = { ok: true; summary: ViewerSummary } | { ok: false };

export interface ViewersAggregator {
  /** The summary under the current switches; `{ok: false}` only when presence never answered in this process. */
  current(): Promise<ViewersRead>;
  /** One background pass: the lease holder reads presence and publishes. Returns whether it published. */
  tick(): Promise<boolean>;
  release(): Promise<void>;
}

/** The summary of a switch-free pass under `switches` (AC-62). */
export function applySwitches(raw: ViewerSummary, switches: Pick<SiteSwitches, 'viewersMap' | 'viewersCount'>): ViewerSummary {
  const countries = switches.viewersMap ? raw.countries : [];
  return switches.viewersCount && raw.people !== undefined ? { countries, people: raw.people, at: raw.at } : { countries, at: raw.at };
}

export function createViewersAggregator(deps: ViewersDeps): ViewersAggregator {
  let pass: { summary: ViewerSummary; readAt: number } | undefined;
  let catalog: { ordered: ViewerCatalogCountry[]; readAt: number } | undefined;
  let inflight: Promise<ViewerSummary | undefined> | undefined;

  async function ordered(now: number): Promise<ViewerCatalogCountry[]> {
    if (catalog === undefined || now - catalog.readAt >= CATALOG_TTL_MS) {
      catalog = { ordered: viewerCatalogOrder(await deps.countries()), readAt: now };
    }
    return catalog.ordered;
  }

  /** Reads presence once and replaces the in-memory pass; `undefined` when presence did not answer. */
  async function refresh(): Promise<ViewerSummary | undefined> {
    const now = deps.clock.now();
    const read = await deps.presence.presence(deps.channel);
    if (read.status !== 'ok') return undefined;
    const summary = aggregateViewers(read.entries, ALL_ON, await ordered(now), new Date(now).toISOString(), deps.cfg);
    pass = { summary, readAt: now };
    return summary;
  }

  /** One refresh at a time per process: concurrent readers share it. */
  function refreshOnce(): Promise<ViewerSummary | undefined> {
    inflight ??= refresh().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  return {
    async current() {
      const fresh = pass !== undefined && deps.clock.now() - pass.readAt < VIEWERS_PASS_MS;
      const raw = fresh ? pass?.summary : ((await refreshOnce()) ?? pass?.summary);
      if (raw === undefined) return { ok: false };
      return { ok: true, summary: applySwitches(raw, await deps.switches()) };
    },

    async tick() {
      if (!(await deps.lease.acquire(LIVE_VIEWERS_LEASE, LEASE_TTL_MS))) return false;
      const raw = await refreshOnce();
      if (raw === undefined || deps.publisher === undefined) return false;
      const summary = applySwitches(raw, await deps.switches());
      const { status } = await deps.publisher.publish(LIVE_VIEWERS_CLASS, undefined, {
        type: VIEWERS_EVENT_TYPE,
        id: `viewers:${Date.parse(summary.at)}`,
        data: summary,
      });
      return status === 'ok';
    },

    release() {
      return deps.lease.release(LIVE_VIEWERS_LEASE);
    },
  };
}

/** A viewer token lives one hour; the tab asks again before it expires, which re-reads the country. */
export const VIEWER_TOKEN_TTL_SECONDS = 3_600;

export interface ViewerTokenDeps {
  /** Absent without `T2F_CENTRIFUGO_TOKEN_SECRET`: 503 `realtime-not-configured`. */
  signer?: SubscriptionSigner;
  /** The channel name of `live:viewers`. */
  channel: string;
  clock: Clock;
}

/** The subscription token of `live:viewers` for a request whose edge country is `country` (AC-59, AC-61). */
export async function issueViewerToken(deps: ViewerTokenDeps, country: string): Promise<ApiResult<RealtimeTokenValue>> {
  if (deps.signer === undefined) return fail('unavailable', { reason: 'realtime-not-configured' });
  const iat = Math.floor(deps.clock.now() / MS_PER_SECOND);
  const exp = iat + VIEWER_TOKEN_TTL_SECONDS;
  const c = viewerCountry(country);
  const token = await deps.signer.signSubscription({ channel: deps.channel, info: c === null ? { p: 1 } : { p: 1, c }, iat, exp });
  return ok({ token, expiresAt: new Date(exp * MS_PER_SECOND).toISOString() });
}

/** The viewer catalog from the stored catalog's country rows: ISO, Ukrainian name, flag code, popularity. */
export function viewerCatalogFrom(rows: readonly Record<string, unknown>[]): ViewerCatalogCountry[] {
  const out: ViewerCatalogCountry[] = [];
  for (const row of rows) {
    const name = (row.name as { uk?: unknown } | null | undefined)?.uk;
    if (typeof row.iso !== 'string' || typeof name !== 'string') continue;
    out.push({
      iso: row.iso,
      name,
      flagCode: typeof row.flagCode === 'string' ? row.flagCode : row.iso.toLowerCase(),
      popularity: typeof row.popularity === 'number' ? row.popularity : 0,
    });
  }
  return out;
}
