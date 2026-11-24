/**
 * Owner and operator actions on the live air (SPEC-12 AC-51 … AC-55, [А10], [А11], [А16]), ring 3. No Payload import,
 * no `Date.now()`: time is the injected clock.
 *
 * `hide` / `unhide`, `main`, `override`, `zone-live`, `replace` each run in ONE transaction: read under the live lock,
 * apply the change, and only when something changes: write it, bump `live-state.version`, append ONE journal row
 * (actor, `before` / `after` with the reason) and publish ONE `live.changed` (a hide carries `hidden`, so the fan-out
 * sends the `hide` event, AC-5). A refusal or a no-op writes nothing. Every row is revertible in one step through the
 * revert handlers of `liveRevertHandlers` (registered in `registries/revertHandlers.ts`).
 *
 * Who: the owner (cms endpoints) and the operator (the `live hide` command, actor «оператор»). An agent actor is
 * refused (`forbidden`) whatever the route checked before. The reason is plain text, 1 … 200 characters after trim.
 * `override` only forces a source playable (`status: 'live'`, [А-R3]); removing or ending a source is `hide`. The
 * strict body refuses any other status; a caller bypassing it is refused `invalid` (`override-status`).
 */
import { LIVE_REASON_MAX, type LiveActionBody } from '@time2fest/contracts';
import type { Actor, Journal, RevertHandler, StoredJournalEntry } from '../audit/ports';
import { chainFull } from '../domain/live/candidates';
import { servedStatus, SOURCE_OVERRIDES, type SourceOverride, type ZoneLive } from '../domain/live/chain';
import { QUOTA_BUCKETS, type LiveConfig, type QuotaBucket } from '../domain/live/config';
import { isWindowOpen, windowOf, type LiveEvent } from '../domain/live/moment';
import { counterOf, nextDayBoundary, quotaDay } from '../domain/live/quota';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import { LIVE_CHANGED_TOPIC, type LiveChangedPayload } from './poller';
import type { LiveEventSource, LiveSource, LiveStore, QuotaStore, SourceEdit, Tx } from './ports';

export const LIVE_HIDE_ACTION = 'live.hide';
export const LIVE_MAIN_ACTION = 'live.main';
export const LIVE_OVERRIDE_ACTION = 'live.override';
export const LIVE_ZONE_LIVE_ACTION = 'live.zone-live';
export const LIVE_REPLACE_ACTION = 'live.replace';
export const LIVE_ACTIONS = [LIVE_HIDE_ACTION, LIVE_MAIN_ACTION, LIVE_OVERRIDE_ACTION, LIVE_REPLACE_ACTION, LIVE_ZONE_LIVE_ACTION] as const;

const SOURCES = 'stream-sources';
const LIVE_STATE = 'live-state';

/** The operator who runs `live hide` on the node at the owner's word ([А16]). */
export const OPERATOR_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'operator', label: 'оператор' });

export interface LiveActionsDeps {
  store: LiveStore;
  events: LiveEventSource;
  journal: Journal;
  publisher: EventPublisher;
  clock: Clock;
  cfg: LiveConfig;
}

export type LiveActionRefusal = 'invalid' | 'forbidden' | 'not-found';
/** `version` = the live version after the call (unchanged when `changed` is false). */
export type LiveActionResult = { ok: true; version: number; changed: boolean } | { ok: false; reason: LiveActionRefusal; detail?: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const OVERRIDES: ReadonlySet<string> = new Set(SOURCE_OVERRIDES);

const refuse = (reason: LiveActionRefusal, detail?: string): LiveActionResult => (detail ? { ok: false, reason, detail } : { ok: false, reason });

/** The reason as journalled, or `null` when it is not 1 … 200 characters of text. */
export function liveReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text.length >= 1 && text.length <= LIVE_REASON_MAX ? text : null;
}

interface Change {
  action: string;
  target: { collection: string; id: string };
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  eventIds: string[];
  hidden?: { eventId: string; sourceId: string }[];
}

/** Writes the journal row and the event of one change, after the version bump, in `tx`. */
async function commit(deps: LiveActionsDeps, tx: Tx, actor: Actor, change: Change, revertOf: string | null): Promise<number> {
  const version = await deps.store.bumpVersion(tx);
  await deps.journal.append(tx, {
    actor,
    action: change.action,
    target: change.target,
    at: deps.clock.now(),
    before: change.before,
    after: change.after,
    revertOf,
  });
  const payload: LiveChangedPayload = { version, eventIds: [...new Set(change.eventIds)].sort(), ...(change.hidden?.length ? { hidden: change.hidden } : {}) };
  await deps.publisher.publish(tx, LIVE_CHANGED_TOPIC, payload);
  return version;
}

/** The source `sourceId` of event `eventId`, read in `tx`. */
async function sourceOf(deps: LiveActionsDeps, tx: Tx, eventId: string, sourceId: string): Promise<LiveSource | null> {
  const [row] = await deps.store.sources({ sourceIds: [sourceId] }, tx);
  return row && row.eventId === eventId ? row : null;
}

const hideView = (s: Pick<LiveSource, 'eventId' | 'sourceId' | 'hidden'>) => ({ eventId: s.eventId, sourceId: s.sourceId, hidden: s.hidden === true });
const overrideView = (s: Pick<LiveSource, 'eventId' | 'sourceId' | 'override'>) => ({ eventId: s.eventId, sourceId: s.sourceId, override: s.override ?? null });
const ordersOf = (sources: readonly LiveSource[]) => Object.fromEntries([...sources].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1)).map((s) => [s.sourceId, s.order]));
/** What a replace row's `after` holds and the revert check compares: the source and its video (a later check may change the status). */
const replaceKey = (s: Pick<LiveSource, 'videoId'> | null, eventId: string, sourceId: string) => ({ eventId, sourceId, exists: s !== null, videoId: s?.videoId ?? null });
/** A replace row's `before`: everything the revert restores. */
const replaceView = (s: LiveSource | null, eventId: string, sourceId: string) =>
  s ? { ...replaceKey(s, eventId, sourceId), status: s.status ?? null, override: s.override ?? null, dead: s.dead === true, deadReason: s.deadReason ?? null } : replaceKey(null, eventId, sourceId);

const byOrder = (a: LiveSource, b: LiveSource) => a.order - b.order || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

/** Sets `hidden` of one source (hide: AC-51, AC-52; unhide and the revert of a hide). */
async function setHidden(deps: LiveActionsDeps, t: Tx, actor: Actor, eventId: string, sourceId: string, hidden: boolean, reason: string, revertOf: string | null): Promise<LiveActionResult> {
  const state = await deps.store.state(t);
  const source = await sourceOf(deps, t, eventId, sourceId);
  if (!source) return refuse('not-found');
  if ((source.hidden === true) === hidden) return { ok: true, version: state.version, changed: false };
  await deps.store.editSource(t, sourceId, { hidden, hiddenReason: hidden ? reason : null });
  const version = await commit(
    deps,
    t,
    actor,
    {
      action: LIVE_HIDE_ACTION,
      target: { collection: SOURCES, id: sourceId },
      before: hideView(source),
      after: { ...hideView({ ...source, hidden }), reason },
      eventIds: [eventId],
      ...(hidden ? { hidden: [{ eventId, sourceId }] } : {}),
    },
    revertOf,
  );
  return { ok: true, version, changed: true };
}

/** Writes the orders of an event's sources (main: AC-53, and its revert). */
async function setOrders(deps: LiveActionsDeps, t: Tx, actor: Actor, eventId: string, sourceId: string, next: (sources: LiveSource[]) => Record<string, number>, reason: string, revertOf: string | null): Promise<LiveActionResult> {
  const state = await deps.store.state(t);
  const sources = await deps.store.sources({ eventIds: [eventId] }, t);
  if (!sources.some((s) => s.sourceId === sourceId)) return refuse('not-found');
  const before = ordersOf(sources);
  const orders = next(sources);
  const changed = sources.filter((s) => orders[s.sourceId] !== undefined && orders[s.sourceId] !== s.order);
  if (changed.length === 0) return { ok: true, version: state.version, changed: false };
  for (const s of changed) await deps.store.editSource(t, s.sourceId, { order: orders[s.sourceId] });
  const after = ordersOf(sources.map((s) => (orders[s.sourceId] !== undefined ? { ...s, order: orders[s.sourceId] as number } : s)));
  const version = await commit(
    deps,
    t,
    actor,
    { action: LIVE_MAIN_ACTION, target: { collection: SOURCES, id: sourceId }, before: { eventId, sourceId, orders: before }, after: { eventId, sourceId, orders: after, reason }, eventIds: [eventId] },
    revertOf,
  );
  return { ok: true, version, changed: true };
}

/** The chosen source first, the others after it in their order, renumbered 0 … n−1. */
function mainFirst(sourceId: string) {
  return (sources: LiveSource[]): Record<string, number> => {
    const rest = [...sources].sort(byOrder).filter((s) => s.sourceId !== sourceId);
    return Object.fromEntries([sourceId, ...rest.map((s) => s.sourceId)].map((id, i) => [id, i]));
  };
}

/** Sets `override` of one source (AC-53, and its revert). */
async function setOverride(deps: LiveActionsDeps, t: Tx, actor: Actor, eventId: string, sourceId: string, override: SourceOverride | null, reason: string, revertOf: string | null): Promise<LiveActionResult> {
  const state = await deps.store.state(t);
  const source = await sourceOf(deps, t, eventId, sourceId);
  if (!source) return refuse('not-found');
  if ((source.override ?? null) === override) return { ok: true, version: state.version, changed: false };
  await deps.store.editSource(t, sourceId, { override });
  const version = await commit(
    deps,
    t,
    actor,
    { action: LIVE_OVERRIDE_ACTION, target: { collection: SOURCES, id: sourceId }, before: overrideView(source), after: { ...overrideView({ ...source, override }), reason }, eventIds: [eventId] },
    revertOf,
  );
  return { ok: true, version, changed: true };
}

/** Sets or clears `zoneLive[zoneId]` (AC-54, and its revert); the events of the zone with stored sources change. */
async function setZone(deps: LiveActionsDeps, t: Tx, actor: Actor, zoneId: string, until: number | null, reason: string, revertOf: string | null): Promise<LiveActionResult> {
  const events = (await deps.events.events()).filter((e) => e.zoneId === zoneId);
  const state = await deps.store.state(t);
  const current = state.zoneLive[zoneId]?.until ?? null;
  if (current === until) return { ok: true, version: state.version, changed: false };
  const next: Record<string, { until: number }> = { ...state.zoneLive };
  if (until === null) delete next[zoneId];
  else next[zoneId] = { until };
  await deps.store.setZoneLive(t, next as ZoneLive);
  const withSources = new Set((await deps.store.sources({ eventIds: events.map((e) => e.eventId) }, t)).map((s) => s.eventId));
  const version = await commit(
    deps,
    t,
    actor,
    {
      action: LIVE_ZONE_LIVE_ACTION,
      target: { collection: LIVE_STATE, id: `zoneLive:${zoneId}` },
      before: { zoneId, until: current },
      after: { zoneId, until, reason },
      eventIds: [...withSources],
    },
    revertOf,
  );
  return { ok: true, version, changed: true };
}

/**
 * Replace by videoId (AC-55): an existing source of the event takes the new video in place, otherwise a new source is
 * added after the event's last one; either way `possible`, unverified (YouTube fields cleared, so it is served only
 * after its check), `adminEditedAt` set, and ONE ad-hoc check queued in the same transaction.
 */
async function replaceSource(deps: LiveActionsDeps, t: Tx, actor: Actor, eventId: string, sourceId: string, videoId: string, reason: string, revertOf: string | null): Promise<LiveActionResult> {
  const now = deps.clock.now();
  const state = await deps.store.state(t);
  const [any] = await deps.store.sources({ sourceIds: [sourceId] }, t);
  if (any && any.eventId !== eventId) return refuse('invalid', 'other-event');
  const own = await deps.store.sources({ eventIds: [eventId] }, t);
  if (own.length === 0 && !(await deps.events.events()).some((e) => e.eventId === eventId)) return refuse('not-found');
  const source = any ?? null;
  if (source && source.videoId === videoId && source.status === 'possible' && !source.override && !source.dead) return { ok: true, version: state.version, changed: false };
  if (source) {
    // The edited source becomes active (dead cleared): the other active ones must leave room for it (AC-23).
    if (source.hidden !== true && source.override !== 'hidden' && chainFull(own.filter((s) => s.sourceId !== sourceId), deps.cfg)) return refuse('invalid', 'chain-full');
    await deps.store.editSource(t, sourceId, { videoId, status: 'possible', override: null, dead: false, deadReason: null, clearYoutube: true, adminEditedAt: now });
  } else {
    // SPEC-21a AC-23: a new source beyond `maxSourcesPerEvent` active ones is refused, nothing written.
    if (chainFull(own, deps.cfg)) return refuse('invalid', 'chain-full');
    const order = own.length ? Math.max(...own.map((s) => s.order)) + 1 : 0;
    await deps.store.insertSource(t, { sourceId, eventId, videoId, order, status: 'possible', adminEditedAt: now });
  }
  await deps.store.addPendingCheck({ sourceId, at: now }, t);
  const version = await commit(
    deps,
    t,
    actor,
    { action: LIVE_REPLACE_ACTION, target: { collection: SOURCES, id: sourceId }, before: replaceView(source, eventId, sourceId), after: { ...replaceKey({ videoId }, eventId, sourceId), reason }, eventIds: [eventId] },
    revertOf,
  );
  return { ok: true, version, changed: true };
}

/** One owner / operator action (the strict body of `/cms-api/live/*`, or the `live hide` command). */
export async function applyLiveAction(deps: LiveActionsDeps, tx: Tx | null, actor: Actor, body: LiveActionBody, revertOf: string | null = null): Promise<LiveActionResult> {
  if (actor.kind === 'agent') return refuse('forbidden');
  const reason = liveReason(body.reason);
  if (reason === null) return refuse('invalid', 'reason');
  switch (body.action) {
    case 'hide':
    case 'unhide':
      return deps.store.inTransaction(tx, (t) => setHidden(deps, t, actor, body.eventId, body.sourceId, body.action === 'hide', reason, revertOf));
    case 'main':
      return deps.store.inTransaction(tx, (t) => setOrders(deps, t, actor, body.eventId, body.sourceId, mainFirst(body.sourceId), reason, revertOf));
    case 'override':
      if ((body.status as string) !== 'live') return refuse('invalid', 'override-status');
      return deps.store.inTransaction(tx, (t) => setOverride(deps, t, actor, body.eventId, body.sourceId, 'live', reason, revertOf));
    case 'zone-live': {
      if (!body.live) return deps.store.inTransaction(tx, (t) => setZone(deps, t, actor, body.zoneId, null, reason, revertOf));
      const now = deps.clock.now();
      const open = (await deps.events.events()).filter((e) => e.zoneId === body.zoneId && !e.hidden && isWindowOpen(e.moment, now, deps.cfg));
      if (open.length === 0) return refuse('invalid', 'no-open-window');
      const until = Math.max(...open.map((e) => windowOf(e.moment, deps.cfg).to));
      return deps.store.inTransaction(tx, (t) => setZone(deps, t, actor, body.zoneId, until, reason, revertOf));
    }
    case 'replace':
      if (!VIDEO_ID.test(body.videoId)) return refuse('invalid', 'video-id');
      return deps.store.inTransaction(tx, (t) => replaceSource(deps, t, actor, body.eventId, body.sourceId, body.videoId, reason, revertOf));
    default:
      return refuse('invalid');
  }
}

// ---- the owner's view (the slice «Ефір»; AC-58) ----

export const LIVE_ACTION_NAMES = ['hide', 'unhide', 'main', 'override', 'zone-live', 'replace'] as const;

export interface LiveViewSource {
  sourceId: string;
  videoId: string | null;
  kind: string | null;
  label: string | null;
  order: number;
  status: string | null;
  /** The status the public chain serves now, or `null` when it is not served. */
  served: string | null;
  override: SourceOverride | null;
  hidden: boolean;
  dead: boolean;
  longNews: boolean;
}

export interface LiveViewSlot {
  which: 'current' | 'next';
  moment: string;
  events: { eventId: string; zoneId: string; zoneLiveUntil: string | null; sources: LiveViewSource[] }[];
}

export interface LiveViewQuota {
  bucket: QuotaBucket;
  used: number;
  perDay: number;
  /** `used / perDay` (the slice shows it as a percent). */
  ratio: number;
  /** The next quota-day boundary, UTC ISO. */
  resetAt: string;
}

export interface LiveView {
  now: string;
  version: number;
  slots: LiveViewSlot[];
  actions: readonly string[];
  quota: LiveViewQuota[];
}

/**
 * The current and the next midnight slot (AC-58: non-midnight and hidden events are not part of either): the current
 * one is the latest moment that has struck whose window is still open, the next one the first moment still to come.
 */
export function midnightSlots(events: readonly LiveEvent[], now: number, cfg: LiveConfig): { which: 'current' | 'next'; moment: number }[] {
  const moments = [...new Set(events.filter((e) => !e.nonMidnight && !e.hidden).map((e) => e.moment))].sort((a, b) => a - b);
  const current = moments.filter((m) => m <= now && now < windowOf(m, cfg).to).pop();
  const next = moments.find((m) => m > now);
  return [...(current !== undefined ? [{ which: 'current' as const, moment: current }] : []), ...(next !== undefined ? [{ which: 'next' as const, moment: next }] : [])];
}

const isoOf = (ms: number) => new Date(ms).toISOString();

/** What the owner's slice «Ефір» shows ([А12]): live sources of the current and next slot, the actions, the quota. */
export async function liveView(deps: Pick<LiveActionsDeps, 'store' | 'events' | 'cfg' | 'clock'>, quota: QuotaStore): Promise<LiveView> {
  const { cfg } = deps;
  const now = deps.clock.now();
  const events = await deps.events.events();
  const slots = midnightSlots(events, now, cfg);
  const inSlots = events.filter((e) => !e.nonMidnight && !e.hidden && slots.some((s) => s.moment === e.moment));
  // Sequential: the reads may share one database session.
  const sources = await deps.store.sources({ eventIds: inSlots.map((e) => e.eventId) });
  const state = await deps.store.state();
  const day = quotaDay(now, cfg.dayTimeZone);
  const counters = await quota.read(day);
  const resetAt = isoOf(nextDayBoundary(now, cfg.dayTimeZone));
  const ctx = { now, cfg, zoneLive: state.zoneLive };
  return {
    now: isoOf(now),
    version: state.version,
    slots: slots.map((slot) => ({
      which: slot.which,
      moment: isoOf(slot.moment),
      events: inSlots
        .filter((e) => e.moment === slot.moment)
        .sort((a, b) => (a.eventId < b.eventId ? -1 : 1))
        .map((e) => ({
          eventId: e.eventId,
          zoneId: e.zoneId,
          zoneLiveUntil: state.zoneLive[e.zoneId] ? isoOf(state.zoneLive[e.zoneId]!.until) : null,
          sources: sources
            .filter((s) => s.eventId === e.eventId)
            .sort(byOrder)
            .map((s) => ({
              sourceId: s.sourceId,
              videoId: s.videoId ?? null,
              kind: s.kind ?? null,
              label: s.label ?? null,
              order: s.order,
              status: s.status ?? null,
              served: servedStatus(s, e, ctx),
              override: s.override ?? null,
              hidden: s.hidden === true,
              dead: s.dead === true,
              longNews: s.longNews === true,
            })),
        })),
    })),
    actions: LIVE_ACTION_NAMES,
    quota: QUOTA_BUCKETS.map((bucket) => {
      const used = counterOf(counters, bucket, now, cfg).used;
      const perDay = cfg.buckets[bucket].perDay;
      return { bucket, used, perDay, ratio: perDay > 0 ? used / perDay : 0, resetAt };
    }),
  };
}

// ---- revert (one step, AC-51 … AC-54) ----

const revertReason = (entry: StoredJournalEntry) => `revert ${entry.id}`.slice(0, LIVE_REASON_MAX);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function unreadable(): never {
  throw new Error('live revert: unreadable journal row');
}

function refused(result: LiveActionResult): void {
  if (!result.ok) throw new Error(`live revert refused: ${result.reason}`);
}

/** The target's current value in the shape of the entry's `after` (the revert check compares every field of it). */
async function currentOf(deps: LiveActionsDeps, tx: Tx, entry: StoredJournalEntry): Promise<Record<string, unknown> | null> {
  const after = entry.after;
  if (!after) return null;
  const reason = { reason: after.reason };
  if (entry.action === LIVE_ZONE_LIVE_ACTION) {
    const zoneId = text(after.zoneId);
    if (!zoneId) return null;
    const state = await deps.store.state(tx);
    return { zoneId, until: state.zoneLive[zoneId]?.until ?? null, ...reason };
  }
  const eventId = text(after.eventId);
  const sourceId = text(after.sourceId);
  if (!eventId || !sourceId) return null;
  if (entry.action === LIVE_MAIN_ACTION) {
    const sources = await deps.store.sources({ eventIds: [eventId] }, tx);
    return { eventId, sourceId, orders: ordersOf(sources), ...reason };
  }
  const [source] = await deps.store.sources({ sourceIds: [sourceId] }, tx);
  if (!source || source.eventId !== eventId) return entry.action === LIVE_REPLACE_ACTION ? { ...replaceKey(null, eventId, sourceId), ...reason } : null;
  if (entry.action === LIVE_HIDE_ACTION) return { ...hideView(source), ...reason };
  if (entry.action === LIVE_OVERRIDE_ACTION) return { ...overrideView(source), ...reason };
  return { ...replaceKey(source, eventId, sourceId), hidden: source.hidden === true, ...reason };
}

/** Restores a row's `before` through the same action functions: one more journal row, a new version. */
async function revertOne(deps: LiveActionsDeps, tx: Tx, entry: StoredJournalEntry, actor: Actor): Promise<void> {
  const before = entry.before ?? unreadable();
  const reason = revertReason(entry);
  await deps.store.inTransaction(tx, async (t) => {
    if (entry.action === LIVE_ZONE_LIVE_ACTION) {
      const zoneId = text(before.zoneId) ?? unreadable();
      const until = typeof before.until === 'number' ? before.until : null;
      return refused(await setZone(deps, t, actor, zoneId, until, reason, entry.id));
    }
    const eventId = text(before.eventId) ?? unreadable();
    const sourceId = text(before.sourceId) ?? unreadable();
    switch (entry.action) {
      case LIVE_HIDE_ACTION:
        return refused(await setHidden(deps, t, actor, eventId, sourceId, before.hidden === true, reason, entry.id));
      case LIVE_OVERRIDE_ACTION: {
        const raw = before.override;
        const override = typeof raw === 'string' && OVERRIDES.has(raw) ? (raw as SourceOverride) : null;
        return refused(await setOverride(deps, t, actor, eventId, sourceId, override, reason, entry.id));
      }
      case LIVE_MAIN_ACTION: {
        const orders = before.orders && typeof before.orders === 'object' ? (before.orders as Record<string, unknown>) : unreadable();
        const restore = (sources: LiveSource[]) =>
          Object.fromEntries(sources.flatMap((s) => (typeof orders[s.sourceId] === 'number' ? [[s.sourceId, orders[s.sourceId] as number]] : [])));
        return refused(await setOrders(deps, t, actor, eventId, sourceId, restore, reason, entry.id));
      }
      case LIVE_REPLACE_ACTION:
        return revertReplace(deps, t, actor, entry, before, reason);
      default:
        return unreadable();
    }
  });
}

/** A replaced source gets its earlier video back (re-checked by the poller); an added one is hidden (never deleted). */
async function revertReplace(deps: LiveActionsDeps, t: Tx, actor: Actor, entry: StoredJournalEntry, before: Record<string, unknown>, reason: string): Promise<void> {
  const eventId = text(before.eventId) ?? unreadable();
  const sourceId = text(before.sourceId) ?? unreadable();
  const source = await sourceOf(deps, t, eventId, sourceId);
  if (!source) unreadable();
  const now = deps.clock.now();
  let edit: SourceEdit;
  if (before.exists !== true) edit = { hidden: true, hiddenReason: reason, adminEditedAt: now };
  else {
    const raw = before.override;
    edit = {
      ...(text(before.videoId) ? { videoId: before.videoId as string } : {}),
      status: text(before.status),
      override: typeof raw === 'string' && OVERRIDES.has(raw) ? (raw as SourceOverride) : null,
      dead: before.dead === true,
      deadReason: text(before.deadReason),
      clearYoutube: true,
      adminEditedAt: now,
    };
  }
  await deps.store.state(t);
  await deps.store.editSource(t, sourceId, edit);
  if (before.exists === true) await deps.store.addPendingCheck({ sourceId, at: now }, t);
  const after = before.exists === true ? replaceKey({ videoId: edit.videoId ?? source.videoId }, eventId, sourceId) : { ...replaceKey(source, eventId, sourceId), hidden: true };
  await commit(
    deps,
    t,
    actor,
    {
      action: LIVE_REPLACE_ACTION,
      target: { collection: SOURCES, id: sourceId },
      before: replaceView(source, eventId, sourceId),
      after: { ...after, reason },
      eventIds: [eventId],
      ...(before.exists !== true ? { hidden: [{ eventId, sourceId }] } : {}),
    },
    entry.id,
  );
}

/**
 * The revert-handler rows of the live air (AC-51 … AC-54; SPEC-02 AC-22). `depsOf` resolves the process's live
 * action deps lazily; `actorOf` names who reverts from the revert's transaction.
 */
export function liveRevertHandlers(depsOf: () => Promise<LiveActionsDeps>, actorOf: (tx: Tx) => Actor): RevertHandler[] {
  return LIVE_ACTIONS.map((key) => ({
    key,
    async current(tx: Tx, entry: StoredJournalEntry) {
      return currentOf(await depsOf(), tx, entry);
    },
    async revert(tx: Tx, entry: StoredJournalEntry) {
      await revertOne(await depsOf(), tx, entry, actorOf(tx));
    },
  }));
}
