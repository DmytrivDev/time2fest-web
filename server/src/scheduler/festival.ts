/**
 * The admin slice «стан свята» (SPEC-07 AC-11, AC-75, AC-78), ring 3: one read of every block.
 *
 * - `phase` — the toast season at server time (`toastSeason`: before / during / after);
 * - `slot` — the current and the next on-air slot (`currentSlotIndex` over the distinct midnights);
 * - `moments` — the next 10 season moments after server time (time, kind, zone or event);
 * - `scheduler` — lease holder, fencing epoch, age of the last renew (both from the lease store, by
 *   the database clock), current lag (only the holding process knows it), skipped + failed in 24 h;
 * - `edge` — the last closed edge-to-origin divergence window (AC-11);
 * - `clock` — real or virtual, speed, run epoch, server instant.
 * Each block is computed in its own `try`: a failed source puts that block into `errors` with neutral
 * placeholders, every other block is still computed (AC-78). Time comes only from `deps.clock`.
 * The lease is READ here, never taken: this view may run in a process that is not the holder.
 */
import type { FestivalStateBlock, FestivalStateMoment, FestivalStateView } from '@time2fest/contracts';
import { currentSlotIndex, seasonMoments, toastSeason, type SeasonInput } from '@time2fest/rules/time';
import { seasonRunEpoch } from '../domain/scheduler/consequence';
import { effective, type VirtualState } from '../domain/timekeeping/virtual';
import type { Clock } from '../ports';
import type { DivergenceReading } from '../timekeeping/divergence';
import type { MomentSource, RunStore } from './ports';
import type { SchedulerStatus } from './service';

/** How many upcoming moments the slice lists (AC-75). */
export const FESTIVAL_MOMENTS = 10;

/** The lease row as the store sees it now, by the database clock. */
export interface LeaseSnapshot {
  /** Holder id `<hostname>:<pid>:<hex>`; `null` when the row has none. */
  holder: string | null;
  epoch: number;
  /** Term left; 0 when expired. */
  expiresInMs: number;
  /** Age of the last acquire/renew, or `null` when never renewed. */
  renewedAgoMs: number | null;
}

/** Read-only view of the scheduler lease (never acquires, never renews). */
export interface LeaseReader {
  /** `null` while no scheduler ever took the lease. Rejects when the store is down. */
  read(): Promise<LeaseSnapshot | null>;
}

export interface FestivalStateDeps {
  /** Server time (virtual in test/rehearsal). */
  clock: Clock;
  /** The shared clock state of test/rehearsal; absent in production (real time, speed 1). */
  clockState?: () => VirtualState;
  source: MomentSource;
  lease: LeaseReader;
  runs: Pick<RunStore, 'missed24h'>;
  /** This process's scheduler: its lag counts only while it holds the lease. */
  scheduler?: { status(): Pick<SchedulerStatus, 'lease' | 'lagMs' | 'runEpoch'> };
  divergence?: { current(): DivergenceReading };
}

const PLACEHOLDER: Omit<FestivalStateView, 'errors'> = {
  phase: 'unknown',
  slot: { current: null, next: null },
  moments: [],
  scheduler: { holder: null, epoch: 0, renewedAgeMs: null, delayMs: null, missed24h: 0 },
  edgeSkewMs: null,
  clock: { virtual: false, speed: 1, epoch: 0 },
};

/** The holder id while the lease is live, else `null`. */
export function liveHolder(lease: LeaseSnapshot | null): string | null {
  return lease && lease.holder && lease.expiresInMs > 0 ? lease.holder : null;
}

/** Slot labels: the zone ids of each distinct midnight, ascending by midnight. */
function slotsOf(input: SeasonInput): { midnightMs: number; label: string }[] {
  const byMidnight = new Map<number, string[]>();
  for (const z of input.zones) {
    const ids = byMidnight.get(z.midnightMs);
    if (ids) ids.push(z.zoneId);
    else byMidnight.set(z.midnightMs, [z.zoneId]);
  }
  return [...byMidnight.entries()].sort((a, b) => a[0] - b[0]).map(([midnightMs, ids]) => ({ midnightMs, label: ids.sort().join(', ') }));
}

function upcoming(input: SeasonInput, now: number): FestivalStateMoment[] {
  const out: FestivalStateMoment[] = [];
  for (const m of seasonMoments(input)) {
    if (m.at <= now) continue;
    out.push({ at: m.at, kind: m.kind, subject: m.eventId ?? m.zoneId ?? null });
    if (out.length === FESTIVAL_MOMENTS) break;
  }
  return out;
}

export async function festivalState(d: FestivalStateDeps): Promise<FestivalStateView> {
  const now = d.clock.now();
  const errors: FestivalStateBlock[] = [];
  const view: FestivalStateView = structuredClone(PLACEHOLDER);

  let input: SeasonInput | undefined;
  try {
    input = await d.source.load();
  } catch {
    errors.push('phase', 'slot', 'moments');
  }
  if (input) {
    const season = input;
    const block = (key: FestivalStateBlock, fn: () => void) => {
      try {
        fn();
      } catch {
        errors.push(key);
      }
    };
    block('phase', () => {
      view.phase = toastSeason(now, season);
    });
    block('slot', () => {
      const slots = slotsOf(season);
      const i = currentSlotIndex(now, slots);
      view.slot = i < 0 ? { current: null, next: null } : { current: slots[i]?.label ?? null, next: slots[i + 1]?.label ?? null };
    });
    block('moments', () => {
      view.moments = upcoming(season, now);
    });
  }

  let status: ReturnType<NonNullable<FestivalStateDeps['scheduler']>['status']> | undefined;
  try {
    status = d.scheduler?.status();
  } catch {
    status = undefined;
  }

  try {
    const [lease, missed] = await Promise.all([d.lease.read(), d.runs.missed24h(now)]);
    view.scheduler = {
      holder: liveHolder(lease),
      epoch: lease?.epoch ?? 0,
      renewedAgeMs: lease?.renewedAgoMs ?? null,
      delayMs: status?.lease.held ? status.lagMs : null,
      missed24h: missed.skipped + missed.failed,
    };
  } catch {
    errors.push('scheduler');
  }

  try {
    const reading = d.divergence?.current();
    view.edgeSkewMs = reading && typeof reading.value === 'number' ? reading.value : null;
  } catch {
    errors.push('edge');
  }

  try {
    const state = d.clockState?.();
    if (state) {
      view.clock = { virtual: state.virtual, speed: effective(state).speed, epoch: state.runEpoch, now };
    } else {
      const epoch = status?.runEpoch ?? (input?.seasonId ? seasonRunEpoch(input.seasonId) : 0);
      view.clock = { virtual: false, speed: 1, epoch, now };
    }
  } catch {
    errors.push('clock');
  }

  if (errors.length > 0) view.errors = errors;
  return view;
}
