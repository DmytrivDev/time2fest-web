/**
 * Payload adapter of the clock-state store (SPEC-07 AC-49, AC-50, NFR-7), ring 4.
 *
 * `change` runs one transaction on a local `req` marked `t2fTrusted` and `t2fInternal` (no per-row
 * journal: the one row of the change is appended here): a transaction-scoped advisory lock (the
 * global's row does not exist before its first write, so a row lock could not serialise the first
 * change; the advisory lock serialises every one, across processes), the read, the write of the
 * global, one journal row and one `clock.changed` outbox row. Any throw rolls all of them back.
 * Payload rows never leave this module: callers get `VirtualState`.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { Journal } from '../audit/ports';
import { initialState, type VirtualState } from '../domain/timekeeping/virtual';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import { CLOCK_CHANGE_ACTION, CLOCK_CHANGED_TOPIC, type ClockChangedPayload, type ClockStateStore } from '../timekeeping/ports';

export const CLOCK_STATE = 'clock-state';

const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const LOCK_KEY = 't2f:clock-state';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** The stored global → state. Missing anchors (never written) mean real time. */
export function toState(doc: Record<string, unknown>, realNow: number): VirtualState {
  const base = initialState(realNow);
  const anchorVirtual = num(doc.anchorVirtual, NaN);
  const anchorReal = num(doc.anchorReal, NaN);
  const anchored = Number.isFinite(anchorVirtual) && Number.isFinite(anchorReal);
  return {
    virtual: doc.virtual === true && anchored,
    anchorVirtual: anchored ? anchorVirtual : base.anchorVirtual,
    anchorReal: anchored ? anchorReal : base.anchorReal,
    speed: num(doc.speed, 1),
    frozen: doc.frozen === true,
    runEpoch: num(doc.runEpoch, 0),
    seq: num(doc.seq, 0),
  };
}

/** The journal view of a state: plain numbers and flags, never a secret (NFR-7). */
function view(s: VirtualState): Record<string, unknown> {
  return { virtual: s.virtual, anchorVirtual: s.anchorVirtual, anchorReal: s.anchorReal, speed: s.speed, frozen: s.frozen, runEpoch: s.runEpoch, seq: s.seq };
}

async function lock(req: PayloadRequest): Promise<void> {
  const db = req.payload.db as unknown as { sessions: Record<string, { db: Exec } | undefined> };
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('clock-state: lock needs an open transaction');
  await session.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
}

export interface PayloadClockStateDeps {
  payload: () => Promise<Payload>;
  journal: Journal;
  publisher: EventPublisher;
  /** Real time: anchors and journal timestamps of a change. */
  real: Clock;
}

export function createPayloadClockStateStore(deps: PayloadClockStateDeps): ClockStateStore {
  const read = async (req: PayloadRequest) =>
    toState(
      (await req.payload.findGlobal({ slug: CLOCK_STATE, req, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>,
      deps.real.now(),
    );
  return {
    async load() {
      const req = await createLocalReq({ context: CONTEXT }, await deps.payload());
      return read(req);
    },
    async change(actor, fn) {
      const req = await createLocalReq({ context: CONTEXT }, await deps.payload());
      await initTransaction(req);
      try {
        await lock(req);
        const before = await read(req);
        const realNow = deps.real.now();
        const after = fn(before, realNow);
        if (after === before) {
          // No change: nothing written, no journal row, no event.
          await commitTransaction(req);
          return before;
        }
        await req.payload.updateGlobal({ slug: CLOCK_STATE, data: view(after) as never, req, depth: 0, overrideAccess: true });
        await deps.journal.append(req, {
          actor,
          action: CLOCK_CHANGE_ACTION,
          target: { collection: CLOCK_STATE, id: CLOCK_STATE },
          at: realNow,
          before: view(before),
          after: view(after),
          revertOf: null,
        });
        const payload: ClockChangedPayload = { seq: after.seq, runEpoch: after.runEpoch };
        await deps.publisher.publish(req, CLOCK_CHANGED_TOPIC, payload);
        await commitTransaction(req);
        return after;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
  };
}
