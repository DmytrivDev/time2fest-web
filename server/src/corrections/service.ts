/**
 * Event corrections (AC-42, AC-53 … AC-62, AC-20, AC-22), ring 3. No Payload import.
 *
 * `saveCorrection` runs in ONE transaction: it serialises with other saves (`store.lock`), validates
 * (`domain/corrections/{rules,range,mainCelebration}`), writes every changed patch with its per-event
 * version + 1, appends ONE journal row (`correction.save`, `before`/`after` = the wire patch of every
 * changed event) and publishes one `event-patch.changed` per changed event, all with the same new
 * `corrections` topic version (see `ports.ts`). A refusal writes nothing. `previewCorrection` answers
 * the same checks with "was → will be" and the warnings, and writes nothing (AC-53).
 *
 * The catalog itself is never written: `GET /api/catalog` and the catalog version do not move (AC-62).
 */
import type { SiteEventPatch } from '@time2fest/contracts';
import { EventPatchChangedSchema } from '@time2fest/contracts/schemas';
import type { Actor, Journal, StoredJournalEntry } from '../audit/ports';
import { applyMainRules, type MainRequest, type MainWarning } from '../domain/corrections/mainCelebration';
import { checkRange } from '../domain/corrections/range';
import {
  applyChange,
  changeRestoring,
  effective,
  localTime,
  samePatch,
  toSitePatch,
  validatePatch,
  type CorrectionReason,
  type EffectiveEvent,
  type EventBase,
  type PatchChange,
  type PatchState,
} from '../domain/corrections/rules';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import type { SiteVersionBump } from '../site/ports';
import type { CorrectionReader, CorrectionStore, StoredPatch, Tx } from './ports';

export const CORRECTION_ACTION = 'correction.save';
export const EVENT_PATCH_CHANGED_TOPIC = 'event-patch.changed';
export const EVENT_PATCHES = 'event-patches';
export const MAX_EVENTS_PER_CORRECTION = 50;
const EVENT_ID = /^[\w.:-]{1,128}$/;

/** Corrections are made by the owner, or by the system on the owner's behalf. */
export type CorrectionActor = Actor & { kind: 'owner' | 'system' };

export interface CorrectionRequest {
  /** eventId → change (`PatchChange`); validated here, the caller passes the parsed body as is. */
  changes: unknown;
  /** eventId → the per-event version the change was based on (0 = no correction yet). */
  expectedVersions: unknown;
  /** Required when the preview had warnings (AC-58). */
  confirmWarnings?: unknown;
}

export interface CorrectionDeps {
  store: CorrectionStore;
  journal: Journal;
  publisher: EventPublisher;
  clock: Clock;
  /** The site snapshot's version grows in the same transaction (SPEC-08 AC-4, AC-8); absent → no bump. */
  siteVersion?: SiteVersionBump;
}

export interface CorrectionItem {
  eventId: string;
  /** `false` for an event changed only as a consequence (the old main of the pair). */
  requested: boolean;
  /** The per-event version before the save. */
  version: number;
  before: EffectiveEvent;
  after: EffectiveEvent;
  /** The moment in the event zone's time, before and after (AC-53). */
  localTime: { before: string | null; after: string | null };
  changed: boolean;
}

export interface CorrectionPreview {
  items: CorrectionItem[];
  warnings: MainWarning[];
}

export type CorrectionResult<T> = { ok: true; value: T } | { ok: false; reason: CorrectionReason; warnings?: MainWarning[] };

interface Planned {
  preview: CorrectionPreview;
  next: Map<string, { base: EventBase; current: StoredPatch | null; state: PatchState }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refuse = (reason: CorrectionReason, warnings?: MainWarning[]): { ok: false; reason: CorrectionReason; warnings?: MainWarning[] } =>
  warnings ? { ok: false, reason, warnings } : { ok: false, reason };
/** A country×zone pair; events of another slot (e.g. `dawn`) never compete with the midnight main. */
const pairKey = (e: Pick<EventBase, 'countryIso' | 'zoneId' | 'slot'>) => `${e.countryIso}\u0000${e.zoneId}\u0000${e.slot}`;

/** Checks a request against the stored state and works out every change it makes. Writes nothing. */
async function planCorrection(store: CorrectionStore, tx: Tx, request: CorrectionRequest): Promise<CorrectionResult<Planned>> {
  const { changes, expectedVersions } = request;
  if (!isRecord(changes) || !isRecord(expectedVersions)) return refuse('invalid-input');
  const ids = Object.keys(changes).sort();
  if (ids.length === 0 || ids.length > MAX_EVENTS_PER_CORRECTION || !ids.every((id) => EVENT_ID.test(id))) return refuse('invalid-input');

  const bases = await store.pairsOf(tx, ids);
  const baseOf = new Map(bases.map((b) => [b.eventId, b]));
  if (!ids.every((id) => baseOf.has(id))) return refuse('unknown-event');
  const stored = new Map((await store.patches(tx, bases.map((b) => b.eventId))).map((p) => [p.eventId, p]));

  const next: Planned['next'] = new Map();
  for (const id of ids) {
    const base = baseOf.get(id) as EventBase;
    const current = stored.get(id) ?? null;
    const change = changes[id];
    const valid = validatePatch(current, change, expectedVersions[id]);
    if (valid !== 'ok') return refuse(valid);
    const c = change as PatchChange;
    if (typeof c.moment === 'number' && checkRange(base.moment, c.moment) !== 'ok') return refuse('correction-out-of-range');
    next.set(id, { base, current, state: applyChange(current?.state ?? null, c) });
  }

  const warnings: MainWarning[] = [];
  const pairs = new Set(ids.map((id) => pairKey(baseOf.get(id) as EventBase)));
  for (const pair of pairs) {
    const members = bases.filter((b) => pairKey(b) === pair);
    const requested: Record<string, MainRequest> = {};
    for (const b of members) {
      const n = next.get(b.eventId);
      if (!n) continue;
      const c = changes[b.eventId] as PatchChange;
      const after = effective(b, n.state);
      requested[b.eventId] = {
        ...(c.isMainCelebration !== undefined ? { isMain: after.isMainCelebration } : {}),
        ...(c.hidden !== undefined ? { hidden: after.hidden } : {}),
      };
    }
    const pairEvents = members.map((b) => {
      const e = effective(b, stored.get(b.eventId)?.state ?? null);
      return { eventId: b.eventId, isMain: e.isMainCelebration, hidden: e.hidden };
    });
    const outcome = applyMainRules(pairEvents, requested);
    if (outcome === 'main-required' || outcome === 'invalid-input') return refuse(outcome);
    warnings.push(...outcome.warnings);
    for (const [id, derived] of Object.entries(outcome.changes)) {
      const n = next.get(id);
      const base = baseOf.get(id) as EventBase;
      const current = stored.get(id) ?? null;
      next.set(id, { base, current, state: applyChange(n?.state ?? current?.state ?? null, derived) });
    }
  }

  const items: CorrectionItem[] = [...next.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([eventId, { base, current, state }]) => {
      const before = effective(base, current?.state ?? null);
      const after = effective(base, state);
      return {
        eventId,
        requested: ids.includes(eventId),
        version: current?.version ?? 0,
        before,
        after,
        localTime: { before: localTime(before.moment, base.offsetMinutes), after: localTime(after.moment, base.offsetMinutes) },
        changed: !samePatch(current?.state ?? null, state),
      };
    });
  return { ok: true, value: { preview: { items, warnings }, next } };
}

/** "Was → will be" with the zone's local time and the warnings (AC-53, AC-58); writes nothing. */
export async function previewCorrection(store: CorrectionStore, tx: Tx, request: CorrectionRequest): Promise<CorrectionResult<CorrectionPreview>> {
  const planned = await planCorrection(store, tx, request);
  return planned.ok ? { ok: true, value: planned.value.preview } : planned;
}

export interface SavedCorrection {
  /** The `corrections` topic version after the save (unchanged when nothing changed). */
  version: number;
  /** The events whose correction changed. */
  eventIds: string[];
}

/** Saves a correction (see the module comment). `revertOf`: the journal row this save reverts. */
export async function saveCorrection(
  deps: CorrectionDeps,
  tx: Tx,
  request: CorrectionRequest,
  actor: CorrectionActor,
  revertOf: string | null = null,
): Promise<CorrectionResult<SavedCorrection>> {
  return deps.store.inTransaction(tx, async () => {
    await deps.store.lock(tx);
    const planned = await planCorrection(deps.store, tx, request);
    if (!planned.ok) return planned;
    const { preview, next } = planned.value;
    if (preview.warnings.length > 0 && request.confirmWarnings !== true) return refuse('warnings-not-confirmed', preview.warnings);

    const changed = preview.items.filter((i) => i.changed);
    const currentTopic = await deps.store.topicVersion(tx);
    if (changed.length === 0) return { ok: true, value: { version: currentTopic, eventIds: [] } };
    const topicVersion = currentTopic + 1;
    const at = deps.clock.now();
    const before: Record<string, SiteEventPatch | null> = {};
    const after: Record<string, SiteEventPatch | null> = {};

    for (const item of changed) {
      const n = next.get(item.eventId) as { current: StoredPatch | null; state: PatchState };
      await deps.store.upsert(tx, { eventId: item.eventId, state: n.state, version: item.version + 1, topicVersion });
      before[item.eventId] = toSitePatch(n.current?.state ?? null);
      after[item.eventId] = toSitePatch(n.state);
    }
    const eventIds = changed.map((i) => i.eventId);
    // Before the first publish: the site lock is always taken before the outbox lock (site/ports.ts).
    await deps.siteVersion?.bumpVersion(tx);
    await deps.journal.append(tx, {
      actor,
      action: CORRECTION_ACTION,
      target: { collection: EVENT_PATCHES, id: eventIds.join(',') },
      at,
      before,
      after,
      revertOf,
    });
    for (const eventId of eventIds) {
      const payload = EventPatchChangedSchema.parse({
        eventId,
        before: before[eventId] ?? null,
        after: after[eventId] ?? null,
        version: topicVersion,
        at: new Date(at).toISOString(),
        actor: { kind: actor.kind, label: actor.label },
      });
      await deps.publisher.publish(tx, EVENT_PATCH_CHANGED_TOPIC, payload);
    }
    return { ok: true, value: { version: topicVersion, eventIds } };
  });
}

/** The events a `correction.save` journal row covers. */
function journalledEvents(entry: Pick<StoredJournalEntry, 'after' | 'before'>): string[] {
  return Object.keys(entry.after ?? entry.before ?? {}).sort();
}

/** The current wire patches of a journalled correction's events, in the shape of its `after` (revert check, AC-22). */
export async function journalledState(store: CorrectionStore, tx: Tx, entry: Pick<StoredJournalEntry, 'after' | 'before'>): Promise<Record<string, unknown> | null> {
  const ids = journalledEvents(entry);
  if (ids.length === 0) return null;
  const stored = new Map((await store.patches(tx, ids)).map((p) => [p.eventId, p]));
  return Object.fromEntries(ids.map((id) => [id, toSitePatch(stored.get(id)?.state ?? null)]));
}

/**
 * Reverts a `correction.save` journal row (AC-22, AC-54): restores every event's `before` through
 * `saveCorrection`, so the new journal row points at the reverted one and the events carry the
 * restored values. A refusal (e.g. the restored state breaks a main-celebration rule) throws, which
 * rolls the revert back.
 */
export async function revertCorrection(deps: CorrectionDeps, tx: Tx, entry: StoredJournalEntry, actor: CorrectionActor): Promise<void> {
  const ids = journalledEvents(entry);
  const stored = new Map((await deps.store.patches(tx, ids)).map((p) => [p.eventId, p]));
  const before = entry.before ?? {};
  const changes = Object.fromEntries(ids.map((id) => [id, changeRestoring((before[id] as SiteEventPatch | null | undefined) ?? null)]));
  const expectedVersions = Object.fromEntries(ids.map((id) => [id, stored.get(id)?.version ?? 0]));
  const result = await saveCorrection(deps, tx, { changes, expectedVersions, confirmWarnings: true }, actor, entry.id);
  if (!result.ok) throw new Error(`correction revert refused: ${result.reason}`);
}

/** Read port (AC-62, AC-42): every current correction as `SiteEventPatch`, with the topic version. */
export async function currentPatches(reader: CorrectionReader): Promise<{ version: number; patches: Record<string, SiteEventPatch> }> {
  const all = await reader.allPatches();
  const patches: Record<string, SiteEventPatch> = {};
  for (const p of [...all].sort((a, b) => (a.eventId < b.eventId ? -1 : 1))) {
    const wire = toSitePatch(p.state);
    if (wire) patches[p.eventId] = wire;
  }
  return { version: all.reduce((max, p) => Math.max(max, p.topicVersion), 0), patches };
}

export interface MomentWithPatch extends EffectiveEvent {
  eventId: string;
  countryIso: string;
  zoneId: string;
}

/** Read port (spec «Порти читання»): every event's moment and flags with its correction applied, with the topic version. */
export async function momentsWithPatches(reader: CorrectionReader): Promise<{ version: number; events: MomentWithPatch[] }> {
  const [events, all] = await Promise.all([reader.allEvents(), reader.allPatches()]);
  const byId = new Map(all.map((p) => [p.eventId, p]));
  return {
    version: all.reduce((max, p) => Math.max(max, p.topicVersion), 0),
    events: events
      .map((b) => ({ eventId: b.eventId, countryIso: b.countryIso, zoneId: b.zoneId, ...effective(b, byId.get(b.eventId)?.state ?? null) }))
      .sort((a, b) => a.moment - b.moment || (a.eventId < b.eventId ? -1 : 1)),
  };
}
