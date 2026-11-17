/**
 * Payload adapter of the unattended-mode ports (AC-31 … AC-36), ring 4.
 *
 * Every read and write runs on the transaction's `req`, marked `t2fTrusted` (server-side call) and
 * `t2fInternal` (no per-row journal: the service appends the one row of the transition). `lock`
 * takes a transaction-scoped advisory lock on that transaction's Postgres session: the state row of
 * a global does not exist before its first write, so a row lock (`SELECT … FOR UPDATE`) could not
 * serialise the first transition; the advisory lock serialises every one, across instances.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import { createPayloadJournal } from '../audit/journal';
import type { AlarmStore } from '../alarms/ports';
import type { UnattendedCause } from '../domain/unattended/machine';
import type { SleepWindow } from '../domain/unattended/windows';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import type { StoredMode, Tx, UnattendedStore } from '../unattended/ports';
import { UNATTENDED_STATE, UNATTENDED_WINDOWS, type UnattendedDeps } from '../unattended/service';

const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const LOCK_KEY = 't2f:unattended';
const CAUSES: readonly string[] = ['schedule', 'manual', 'alarm'];

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

function inner(tx: Tx): PayloadRequest {
  const req = tx as PayloadRequest;
  return { ...req, context: { ...req.context, ...CONTEXT } } as PayloadRequest;
}

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const iso = (v: number | null) => (v === null ? null : new Date(v).toISOString());

/** Takes the unattended-mode advisory lock until the transaction of `req` ends. */
export async function lockUnattended(req: PayloadRequest): Promise<void> {
  const db = req.payload.db as unknown as { sessions: Record<string, { db: Exec } | undefined> };
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('unattended: lock needs an open transaction');
  await session.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
}

function toMode(doc: Record<string, unknown>): StoredMode {
  const cause = typeof doc.cause === 'string' && CAUSES.includes(doc.cause) ? (doc.cause as UnattendedCause) : null;
  const manualAt = cause === 'manual' ? ms(doc.manualAt) : null;
  return {
    on: doc.on === true,
    cause: cause === 'manual' && manualAt === null ? null : cause,
    manualAt,
    version: Number(doc.version ?? 0) || 0,
    changedAt: ms(doc.changedAt),
  };
}

export function toWindow(doc: Record<string, unknown>): SleepWindow | null {
  const startsAt = ms(doc.startsAt);
  const endsAt = ms(doc.endsAt);
  return startsAt === null || endsAt === null ? null : { id: String(doc.id), startsAt, endsAt };
}

/** Every stored window, in start order, read in the transaction `tx` as a server-side call. */
export async function windowsOn(tx: Tx): Promise<SleepWindow[]> {
  const req = inner(tx);
  const found = await req.payload.find({ collection: UNATTENDED_WINDOWS, req, sort: 'startsAt', pagination: false, depth: 0, overrideAccess: true });
  return found.docs.map((d) => toWindow(d as unknown as Record<string, unknown>)).filter((w): w is SleepWindow => w !== null);
}

export function createPayloadUnattendedStore(getPayload: () => Promise<Payload>): UnattendedStore {
  return {
    async inTransaction(tx, fn) {
      const req = tx ? (tx as PayloadRequest) : await createLocalReq({ context: CONTEXT }, await getPayload());
      const started = await initTransaction(req);
      try {
        const result = await fn(req);
        if (started) await commitTransaction(req);
        return result;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
    lock: (tx) => lockUnattended(tx as PayloadRequest),
    async state(tx) {
      const req = inner(tx);
      const doc = await req.payload.findGlobal({ slug: UNATTENDED_STATE, req, depth: 0, overrideAccess: true });
      return toMode(doc as unknown as Record<string, unknown>);
    },
    async write(tx, state) {
      const req = inner(tx);
      const data = { on: state.on, cause: state.cause, manualAt: iso(state.manualAt), version: state.version, changedAt: iso(state.changedAt) };
      await req.payload.updateGlobal({ slug: UNATTENDED_STATE, data: data as never, req, depth: 0, overrideAccess: true });
    },
    windows: (tx) => windowsOn(tx),
  };
}

/** The dependencies of the unattended service over Payload; `isRevertible` comes from the revert-handler registry. */
export function payloadUnattendedDeps(opts: {
  payload: () => Promise<Payload>;
  alarms: Pick<AlarmStore, 'listOpenPage'>;
  publisher: EventPublisher;
  clock: Clock;
  isRevertible: (action: string) => boolean;
}): UnattendedDeps {
  return {
    store: createPayloadUnattendedStore(opts.payload),
    alarms: opts.alarms,
    journal: createPayloadJournal(opts.isRevertible),
    publisher: opts.publisher,
    clock: opts.clock,
  };
}
