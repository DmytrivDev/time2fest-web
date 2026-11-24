/**
 * The hourly «усе гаразд» (SPEC-13b AC-18, AC-19, AC-21, AC-22), ring 3 — ports only, wall-clock `now`.
 *
 * Each run: the window of the celebration from the catalog zones (cached 10 min; unavailable or empty → the
 * fallback window and ONE `log` alarm `ops/heartbeat-fallback-window` per window, raised only while that window
 * is used); the last slot due (`heartbeatSlotAt`). A slot not handled by this process yet is planned under the
 * `ops-heartbeat` lease: ≤10 min late → one `kind: 'heartbeat'` outbox row with the unique `slotKey` (a second
 * insert anywhere in the cluster is refused → exactly one message per slot); later → no row, and a journal line
 * `ops.heartbeat-skipped` unless the slot was already queued (by another instance or before a restart).
 * The sender job delivers the row like any other.
 */
import type { ZonesLike } from '@time2fest/rules/time';
import { buildHeartbeatText, type DeliveryState } from '../domain/ops/alarmText';
import { celebrationWindow, heartbeatSlotAt, missedSlotDecision, type CelebrationWindow, type Slot } from '../domain/ops/schedule';
import type { EnvClass } from '../platform/env';
import type { Alarm } from '../ports';
import type { OpsJournal, OpsLease, Outbox } from './ports';

export const HEARTBEAT_LEASE_TTL_MS = 15_000;
const ZONES_CACHE_MS = 600_000;
const MAX_REMEMBERED = 200;

/** What one run of a planning job did (the `ops-tick` door answers it). */
export interface PlanOutcome {
  result: 'idle' | 'not-held' | 'queued' | 'duplicate' | 'skipped' | 'too-late';
  slotKey?: string;
}

/** Reads shared by the heartbeat and the digest. */
export interface OpsReads {
  /** Zones of the catalog; `null` or a throw → the fallback window (AC-19). */
  zones(): Promise<ZonesLike | null>;
  /** Open (unacknowledged) `page` alarms. */
  openPageCount(): Promise<number>;
  /** Epoch ms of the last successful backup; `null` — none yet (backups land in S8). */
  lastBackupAt(): Promise<number | null>;
  /** State of Telegram delivery as this process saw it. */
  deliveryState(now: number): DeliveryState;
}

export interface PlanJobDeps {
  lease: OpsLease;
  outbox: Pick<Outbox, 'insert' | 'hasSlot'>;
  journal: OpsJournal;
  reads: OpsReads;
  alarm: Alarm;
  chatId: string;
  cls: EnvClass;
}

export interface PlanJob {
  run(now: number): Promise<PlanOutcome>;
}

/** Keys of slots this process already handled (bounded). */
export function slotMemory(): { has(key: string): boolean; add(key: string): void } {
  const keys = new Set<string>();
  return {
    has: (key) => keys.has(key),
    add(key) {
      keys.add(key);
      if (keys.size > MAX_REMEMBERED) keys.delete(keys.values().next().value as string);
    },
  };
}

/**
 * Plans one slot under the `ops-heartbeat` lease: queue it (≤10 min late) or journal the skip. `text` is built
 * only when the row is queued.
 */
export async function planSlot(
  deps: PlanJobDeps,
  memory: ReturnType<typeof slotMemory>,
  slot: Slot,
  now: number,
  skipAction: string,
  kind: 'digest' | 'heartbeat',
  text: () => Promise<string>,
): Promise<PlanOutcome> {
  const decision = missedSlotDecision(slot, now);
  if (decision === 'wait') return { result: 'idle' };
  if (!(await deps.lease.acquire('ops-heartbeat', HEARTBEAT_LEASE_TTL_MS))) return { result: 'not-held', slotKey: slot.key };
  if (decision === 'send') {
    const out = await deps.outbox.insert({ kind, slotKey: slot.key, text: await text(), chatId: deps.chatId, createdAt: now });
    memory.add(slot.key);
    return { result: out === 'duplicate-slot' ? 'duplicate' : 'queued', slotKey: slot.key };
  }
  if (await deps.outbox.hasSlot(slot.key)) {
    memory.add(slot.key);
    return { result: 'duplicate', slotKey: slot.key };
  }
  await deps.journal.line(skipAction, slot.key, { slotKey: slot.key, dueAt: new Date(slot.due).toISOString(), lateMs: now - slot.due }, now);
  memory.add(slot.key);
  return { result: 'skipped', slotKey: slot.key };
}

export function createHeartbeatJob(deps: PlanJobDeps): PlanJob {
  const memory = slotMemory();
  const fallbackAlarmed = new Set<number>();
  let cached: { at: number; window: CelebrationWindow } | undefined;

  async function windowAt(now: number): Promise<CelebrationWindow> {
    if (cached && Math.abs(now - cached.at) < ZONES_CACHE_MS) return cached.window;
    let zones: ZonesLike | null = null;
    try {
      zones = await deps.reads.zones();
    } catch {
      zones = null;
    }
    const window = celebrationWindow(zones, now);
    // A fallback window is not cached: the catalog may come back on the next run.
    cached = window.fallback ? undefined : { at: now, window };
    return window;
  }

  return {
    async run(now) {
      const window = await windowAt(now);
      const slot = heartbeatSlotAt(now, window);
      if (!slot || memory.has(slot.key)) return { result: 'idle' };
      if (window.fallback && !fallbackAlarmed.has(window.start)) {
        fallbackAlarmed.add(window.start);
        deps.alarm.raise({ level: 'log', source: 'ops', code: 'heartbeat-fallback-window' });
      }
      return planSlot(deps, memory, slot, now, 'ops.heartbeat-skipped', 'heartbeat', async () => {
        const [openPage, lastBackupAt] = await Promise.all([deps.reads.openPageCount(), deps.reads.lastBackupAt()]);
        return buildHeartbeatText({
          cls: deps.cls,
          openPage,
          lastBackupAgeMs: lastBackupAt === null ? null : now - lastBackupAt,
          delivery: deps.reads.deliveryState(now),
          at: slot.due,
        });
      });
    },
  };
}
