/**
 * The public chains (SPEC-12 AC-8, AC-9, AC-10, AC-29, AC-30, AC-57, AC-58, AC-74), ring 1 — pure, time is a parameter.
 *
 * A stored source is public only when every rule holds:
 * - platform `youtube` with a videoId (`iframe-official`, `hls`, `none` exist in the model only — AC-8);
 * - not hidden (flag or `override: hidden`), not ended by `override`, not dead — unless `override: live` (AC-9);
 * - `embeddable` is true and `privacyStatus`, when known, is `public` (AC-29); fields cleared by retention → out;
 * - a YouTube fetch, when there is one, not older than `retentionMs` (AC-74);
 * - a long news source only inside its window around the event moment (AC-57);
 * - a servable status: `override: live` › zone-live until its `until` (AC-54) › the stored status, with the −5 min
 *   rule (AC-28).
 * Survivors are ordered by `order` then `sourceId`, so a dead first source leaves the next one first (AC-30).
 * An event with the `hidden` correction has no chain at all (AC-10); an event whose sources all fail has
 * `sources: []`.
 */
import type { StreamChain, StreamKind, StreamSource, StreamStatus } from '@time2fest/contracts';
import type { LiveConfig } from './config';
import { isLongNewsOpen, type LiveEvent } from './moment';
import { asStreamStatus, publishedStatus } from './status';

export const SOURCE_PLATFORMS = ['youtube', 'iframe-official', 'hls', 'none'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];
export const SOURCE_OVERRIDES = ['live', 'ended', 'hidden'] as const;
export type SourceOverride = (typeof SOURCE_OVERRIDES)[number];
const KINDS: ReadonlySet<string> = new Set<StreamKind>(['main', 'webcam', 'tv']);
const DEFAULT_KIND: StreamKind = 'main';

/** A `stream-sources` row as the domain reads it (times as epoch ms, absent = `null`). */
export interface StoredSource {
  sourceId: string;
  eventId: string;
  platform: SourcePlatform;
  videoId?: string | null;
  kind?: string | null;
  label?: string | null;
  name?: string | null;
  order: number;
  startsAt?: number | null;
  status?: string | null;
  embeddable?: boolean | null;
  privacyStatus?: string | null;
  ytFetchedAt?: number | null;
  lastChecked?: number | null;
  override?: SourceOverride | null;
  hidden?: boolean | null;
  dead?: boolean | null;
  longNews?: boolean | null;
}

/** `live-state.zoneLive`: zones marked live by the owner, each until a moment (AC-54). */
export type ZoneLive = Readonly<Record<string, { until: number }>>;

export interface ChainContext {
  now: number;
  cfg: LiveConfig;
  zoneLive?: ZoneLive;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** The status a source is served with, or `null` when it is not served. */
export function servedStatus(source: StoredSource, event: LiveEvent, ctx: ChainContext): StreamStatus | null {
  const { now, cfg } = ctx;
  if (source.platform !== 'youtube' || !source.videoId) return null;
  if (source.hidden || source.override === 'hidden' || source.override === 'ended') return null;
  const overridden = source.override === 'live';
  if (source.dead && !overridden) return null;
  if (source.embeddable !== true) return null;
  if (source.privacyStatus != null && source.privacyStatus !== 'public') return null;
  if (source.ytFetchedAt != null && now - source.ytFetchedAt > cfg.retentionMs) return null;
  if (source.longNews && !isLongNewsOpen(event.moment, now, cfg)) return null;
  if (overridden) return 'live';
  const zone = ctx.zoneLive?.[event.zoneId];
  if (zone && now < zone.until) return 'live';
  const stored = asStreamStatus(source.status);
  if (!stored) return null;
  const startsAt = source.startsAt != null ? iso(source.startsAt) : null;
  return publishedStatus(stored, startsAt, event.moment, now, cfg);
}

function toWire(source: StoredSource & { videoId: string }, status: StreamStatus, event: LiveEvent): StreamSource {
  const startsAtMs = source.startsAt ?? (event.nonMidnight ? event.moment : null);
  const checked = source.lastChecked ?? source.ytFetchedAt;
  return {
    id: source.sourceId,
    platform: 'youtube',
    videoId: source.videoId,
    url: youtubeUrl(source.videoId),
    kind: source.kind && KINDS.has(source.kind) ? (source.kind as StreamKind) : DEFAULT_KIND,
    title: { uk: source.name ?? source.label ?? '' },
    order: source.order,
    status,
    ...(startsAtMs != null && (status === 'expected' || event.nonMidnight) ? { startsAt: iso(startsAtMs) } : {}),
    embeddable: true,
    lastChecked: checked != null ? iso(checked) : '',
    verified: source.ytFetchedAt != null,
    isLive: status === 'live',
    ...(source.override === 'live' ? { override: true } : {}),
  };
}

const byOrder = (a: StoredSource, b: StoredSource): number =>
  a.order - b.order || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

/** The public chain of one event, or `null` for a hidden event. */
export function publicChain(event: LiveEvent, sources: readonly StoredSource[], ctx: ChainContext): StreamChain | null {
  if (event.hidden) return null;
  const out: StreamSource[] = [];
  for (const s of [...sources].sort(byOrder)) {
    if (s.eventId !== event.eventId) continue;
    const status = servedStatus(s, event, ctx);
    if (status && s.videoId) out.push(toWire({ ...s, videoId: s.videoId }, status, event));
  }
  return { eventId: event.eventId, sources: out };
}

/** Chains of every event that has stored sources, in the order of `events`; hidden events and unknown ids skipped. */
export function publicChains(events: readonly LiveEvent[], sources: readonly StoredSource[], ctx: ChainContext): StreamChain[] {
  const byEvent = new Map<string, StoredSource[]>();
  for (const s of sources) {
    const list = byEvent.get(s.eventId);
    if (list) list.push(s);
    else byEvent.set(s.eventId, [s]);
  }
  const chains: StreamChain[] = [];
  for (const e of events) {
    const own = byEvent.get(e.eventId);
    if (!own) continue;
    const chain = publicChain(e, own, ctx);
    if (chain) chains.push(chain);
  }
  return chains;
}
