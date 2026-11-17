/**
 * Payload adapter of the correction ports (AC-42, AC-53 … AC-62), ring 4.
 *
 * Every write and read inside a save goes through the caller's `req` (its transaction) marked
 * `t2fTrusted` (server-side call) and `t2fInternal` (no per-row journal: the service appends the one
 * row of the correction). `lock` takes a transaction-scoped advisory lock on the Postgres session of
 * that transaction, so two saves never read the same versions.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest, Where } from 'payload';
import { createPayloadJournal } from '../audit/journal';
import type { CorrectionReader, CorrectionStore, StoredPatch, Tx } from '../corrections/ports';
import { EVENT_PATCHES, type CorrectionDeps } from '../corrections/service';
import type { EventBase, PatchState } from '../domain/corrections/rules';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';

const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const LOCK_KEY = 't2f:corrections';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

function inner(tx: Tx): PayloadRequest {
  const req = tx as PayloadRequest;
  return { ...req, context: { ...req.context, ...CONTEXT } } as PayloadRequest;
}

type Source = { req: PayloadRequest } | { context: typeof CONTEXT };
const sourceOf = (tx: Tx | undefined): Source => (tx ? { req: inner(tx) } : { context: CONTEXT });

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function toBase(row: Record<string, unknown>, offsets: Map<string, number>): EventBase {
  const slot = typeof row.slot === 'string' && row.slot ? row.slot : 'midnight';
  const at = slot === 'midnight' ? row.midnightUtc : row.startsAt;
  return {
    eventId: String(row.eventId),
    countryIso: String(row.countryIso),
    zoneId: String(row.zoneId),
    slot,
    moment: Date.parse(String(at)),
    isMainCelebration: row.isMainCelebration === true,
    offsetMinutes: offsets.get(String(row.zoneId)) ?? null,
  };
}

function toPatch(row: Record<string, unknown>): StoredPatch {
  const main = row.isMainCelebration;
  const state: PatchState = {
    moment: num(row.moment),
    isMainCelebration: typeof main === 'boolean' ? main : null,
    restrained: row.restrained === true,
    restrainedNote: typeof row.restrainedNote === 'string' ? row.restrainedNote : null,
    hidden: row.hidden === true,
  };
  return { eventId: String(row.eventId), state, version: Number(row.version ?? 0), topicVersion: Number(row.topicVersion ?? 0) };
}

async function findAll(payload: Payload, collection: 'events' | 'zones' | typeof EVENT_PATCHES, where: Where | undefined, tx?: Tx) {
  const found = await payload.find({
    collection,
    ...(where ? { where } : {}),
    ...sourceOf(tx),
    depth: 0,
    pagination: false,
    overrideAccess: true,
  });
  return found.docs as unknown as Record<string, unknown>[];
}

async function basesOf(payload: Payload, events: Record<string, unknown>[], tx?: Tx): Promise<EventBase[]> {
  const zoneIds = [...new Set(events.map((e) => String(e.zoneId)))];
  const zones = zoneIds.length > 0 ? await findAll(payload, 'zones', { zoneId: { in: zoneIds } }, tx) : [];
  const offsets = new Map(zones.map((z) => [String(z.zoneId), Number(z.offsetMinutes)]));
  return events.map((e) => toBase(e, offsets));
}

export function createPayloadCorrectionStore(): CorrectionStore {
  return {
    async inTransaction(tx, fn) {
      const req = tx as PayloadRequest;
      const started = await initTransaction(req);
      try {
        const result = await fn();
        if (started) await commitTransaction(req);
        return result;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
    async lock(tx) {
      const req = tx as PayloadRequest;
      const db = req.payload.db as unknown as { sessions: Record<string, { db: Exec } | undefined> };
      const id = req.transactionID;
      const session = id ? db.sessions[String(await id)]?.db : undefined;
      if (!session) throw new Error('corrections: lock needs an open transaction');
      await session.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
    },
    async pairsOf(tx, eventIds) {
      const payload = (tx as PayloadRequest).payload;
      const own = await findAll(payload, 'events', { eventId: { in: [...eventIds] } }, tx);
      if (own.length === 0) return [];
      const pairs = [...new Map(own.map((e) => [`${e.countryIso}|${e.zoneId}`, e])).values()];
      const members = await findAll(
        payload,
        'events',
        { or: pairs.map((e): Where => ({ and: [{ countryIso: { equals: String(e.countryIso) } }, { zoneId: { equals: String(e.zoneId) } }] })) },
        tx,
      );
      const bases = await basesOf(payload, members, tx);
      const slots = new Set(bases.filter((b) => eventIds.includes(b.eventId)).map((b) => `${b.countryIso}|${b.zoneId}|${b.slot}`));
      return bases.filter((b) => slots.has(`${b.countryIso}|${b.zoneId}|${b.slot}`));
    },
    async patches(tx, eventIds) {
      if (eventIds.length === 0) return [];
      const rows = await findAll((tx as PayloadRequest).payload, EVENT_PATCHES, { eventId: { in: [...eventIds] } }, tx);
      return rows.map(toPatch);
    },
    async topicVersion(tx) {
      const req = inner(tx);
      const found = await req.payload.find({ collection: EVENT_PATCHES, req, sort: '-topicVersion', limit: 1, depth: 0, overrideAccess: true });
      const top = found.docs[0] as unknown as Record<string, unknown> | undefined;
      return top ? Number(top.topicVersion ?? 0) : 0;
    },
    async upsert(tx, patch) {
      const req = inner(tx);
      const data = {
        eventId: patch.eventId,
        moment: patch.state.moment,
        isMainCelebration: patch.state.isMainCelebration,
        restrained: patch.state.restrained,
        restrainedNote: patch.state.restrainedNote,
        hidden: patch.state.hidden,
        version: patch.version,
        topicVersion: patch.topicVersion,
      };
      const found = await req.payload.find({ collection: EVENT_PATCHES, req, where: { eventId: { equals: patch.eventId } }, limit: 1, depth: 0, overrideAccess: true });
      const existing = found.docs[0] as unknown as { id: string | number } | undefined;
      if (existing) await req.payload.update({ collection: EVENT_PATCHES, id: existing.id, data: data as never, req, depth: 0, overrideAccess: true });
      else await req.payload.create({ collection: EVENT_PATCHES, data: data as never, req, depth: 0, overrideAccess: true });
    },
  };
}

export function createPayloadCorrectionReader(getPayload: () => Promise<Payload>): CorrectionReader {
  return {
    async allEvents() {
      const payload = await getPayload();
      return basesOf(payload, await findAll(payload, 'events', undefined));
    },
    async allPatches() {
      const payload = await getPayload();
      return (await findAll(payload, EVENT_PATCHES, undefined)).map(toPatch);
    },
  };
}

/** The dependencies of `saveCorrection` over Payload; `isRevertible` comes from the revert-handler registry. */
export function payloadCorrectionDeps(opts: { publisher: EventPublisher; clock: Clock; isRevertible: (action: string) => boolean }): CorrectionDeps {
  return { store: createPayloadCorrectionStore(), journal: createPayloadJournal(opts.isRevertible), publisher: opts.publisher, clock: opts.clock };
}
