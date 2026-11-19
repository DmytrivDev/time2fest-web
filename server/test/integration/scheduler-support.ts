/**
 * Support of the scheduler evidence suites (SPEC-07 W39, W40): THE process deps of the test process
 * (the run recorder and the recompute subscriber reach them through `processDeps`), its dispatcher
 * for the doors, the event bus, and schedulers built like `container.ts` builds the process one —
 * same Postgres lease and run stores, same moment source, same shared clock view — but with the rows,
 * the lease name, the logger and the alarm a test chooses. Plus the run analysis shared with
 * `scripts/night-run.mjs`: every (moment, action) pair once, C1 order, groups as enumerated.
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { seasonMoments, type SeasonMoment, type SeasonMomentKind } from '@time2fest/rules/time';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadMomentSource } from '../../src/adapters/payloadMoments';
import { createPayloadRunRecordStore } from '../../src/adapters/payloadRunRecords';
import { createPgScheduler } from '../../src/adapters/pgScheduler';
import type { LateRule } from '../../src/domain/scheduler/late';
import { buildDispatcher, getDeps, payloadOf, startBackground } from '../../src/container';
import { catalogStoreOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import { createAlarm } from '../../src/platform/logger';
import type { Alarm, Logger } from '../../src/ports';
import { isRevertible } from '../../src/registries/revertHandlers';
import type { MomentActionGroup, MomentActionRow, MomentSource } from '../../src/scheduler/ports';
import type { RunRecord } from '../../src/scheduler/recorder';
import { createScheduler, type SchedulerHandle } from '../../src/scheduler/service';

export const BASE = 'http://127.0.0.1:3000';
export const SEC = 1_000;
export const MIN = 60_000;
const JSON_TYPE = { 'content-type': 'application/json' };

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls `fn` until it returns a value other than `undefined`/`false`: every 20 ms when it is sync,
 * every 200 ms when it returns a promise (a database read), so the poll does not load the database.
 */
export async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms: number, label: string): Promise<T> {
  const end = performance.now() + ms;
  for (;;) {
    const r = fn();
    const v = await r;
    if (v !== undefined && v !== false) return v;
    if (performance.now() > end) throw new Error(`timed out after ${ms} ms: ${label}`);
    await sleep(r instanceof Promise ? 200 : 20);
  }
}

// ---- captured logs ------------------------------------------------------------------------------

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
}

export function captureLog(into: LogLine[] = []): { log: Logger; lines: LogLine[] } {
  return {
    lines: into,
    log: {
      info: (fields) => into.push({ level: 'info', fields }),
      warn: (fields) => into.push({ level: 'warn', fields }),
      error: (fields) => into.push({ level: 'error', fields }),
    },
  };
}

/** Values of secret-looking environment variables (≥ 8 chars): none may appear in a log line (NFR-7). */
export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!v || v.length < 8 || !/SECRET|_KEY|PASSWORD|TOKEN/.test(k)) continue;
    out.push(v);
  }
  const db = env.DATABASE_URI;
  if (db) {
    try {
      const pw = decodeURIComponent(new URL(db).password);
      if (pw.length >= 4) out.push(pw);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

// ---- the process harness ------------------------------------------------------------------------

type DbPool = { query<R = Record<string, unknown>>(q: string, v?: unknown[]): Promise<{ rows: R[] }> };

export interface RunRow {
  action: string;
  moment_key: string;
  status: string;
  reason: string | null;
  consequence_id: string | null;
}

export interface Harness {
  deps: Deps;
  payload: Payload;
  dispatch(r: Request): Promise<Response>;
  /** POST to a door; throws unless 200. */
  door<T = Record<string, unknown>>(path: string, body: unknown): Promise<T>;
  /** `POST /api/_test/scheduler/night-run` → the new run epoch. */
  nightRun(body: { speed?: number; from?: number; to?: number }): Promise<number>;
  /** `POST /api/_test/clock`. */
  clock(change: { at?: number; speed?: number; frozen?: boolean }): Promise<void>;
  /** Server time of this process (the shared clock view). */
  now(): number;
  /** The anchors of the shared clock (real and server ms at the last change, speed). */
  anchor(): { real: number; server: number; speed: number };
  /** The season moments of the stored catalog with its corrections, C1 order. */
  moments(): Promise<SeasonMoment[]>;
  /** The run recorder's rows of an epoch, by real start. */
  records(epoch: number): Promise<RunRecord[]>;
  runRows(epoch: number, action?: string): Promise<RunRow[]>;
  pool: DbPool;
  close(): Promise<void>;
}

/** THE process deps (class `test`, doors on), Payload, dispatcher, a reset worktree and (optionally) the bus. */
export async function bootHarness(opts: { bus?: boolean } = {}): Promise<Harness> {
  process.env.T2F_ENV = 'test';
  process.env.T2F_TEST_DOORS = '1';
  delete process.env.T2F_EDGE_SECRET;
  const deps = getDeps();
  const payload = await payloadOf(deps)();
  const dispatch = await buildDispatcher(deps);
  const bus: EventBus | undefined = opts.bus ? await startBackground(deps) : undefined;
  const pool = (payload.db as unknown as { pool: DbPool }).pool;
  const source = createPayloadMomentSource({ payload: payloadOf(deps), catalog: catalogStoreOf(deps) });
  const recordStore = createPayloadRunRecordStore(payloadOf(deps));
  const shared = deps.sharedClock;
  if (!shared) throw new Error('no shared clock in the test class');

  async function door<T>(path: string, body: unknown): Promise<T> {
    const res = await dispatch(new Request(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
    const json = (await res.json()) as { ok: boolean; value?: T };
    if (res.status !== 200) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    return json.value as T;
  }

  await door('/api/_test/reset', {});
  return {
    deps,
    payload,
    dispatch,
    door,
    pool,
    async nightRun(body) {
      return (await door<{ epoch: number }>('/api/_test/scheduler/night-run', body)).epoch;
    },
    async clock(change) {
      await door('/api/_test/clock', change);
    },
    now: () => shared.view().now,
    anchor() {
      const s = shared.state();
      return { real: s.anchorReal, server: s.anchorVirtual, speed: s.speed };
    },
    async moments() {
      return seasonMoments(await source.load());
    },
    records: (epoch) => recordStore.list(epoch),
    async runRows(epoch, action) {
      const { rows } = await pool.query<RunRow>(
        `SELECT "action", "moment_key", "status", "reason", "consequence_id" FROM "scheduler_runs" WHERE "run_epoch" = $1 ${action ? 'AND "action" = $2' : ''} ORDER BY "id"`,
        action ? [epoch, action] : [epoch],
      );
      return rows;
    },
    async close() {
      await door('/api/_test/reset', {}).catch(() => {});
      await bus?.stop();
    },
  };
}

// ---- schedulers built like the process one ------------------------------------------------------

export interface TestSchedulerOptions {
  rows: readonly MomentActionRow[];
  /** Lease row name (default: a private one per call, so no other scheduler is met). */
  leaseName?: string;
  holderId?: string;
  source?: MomentSource;
  log?: Logger;
  /** Default: a fresh `createAlarm(log, alarmStore)` (its own throttle), saving `page` rows. */
  alarm?: Alarm;
}

export interface TestScheduler {
  handle: SchedulerHandle;
  holderId: string;
  leaseName: string;
}

export function privateLeaseName(tag: string): string {
  return `scheduler-${tag}-${randomBytes(4).toString('hex')}`;
}

export function testScheduler(deps: Deps, o: TestSchedulerOptions): TestScheduler {
  const shared = deps.sharedClock;
  if (!shared) throw new Error('no shared clock in the test class');
  const leaseName = o.leaseName ?? privateLeaseName('test');
  const holderId = o.holderId ?? `test:${process.pid}:${randomBytes(4).toString('hex')}`;
  const stores = createPgScheduler({ payload: payloadOf(deps), journal: createPayloadJournal(isRevertible), name: leaseName });
  const log = o.log ?? captureLog().log;
  const handle = createScheduler({
    // As `createProcessScheduler`: the shared view, `since` = the last anchor of a virtual clock.
    view: () => {
      const s = shared.state();
      return { ...shared.view(), ...(s.virtual ? { since: s.anchorVirtual } : {}) };
    },
    mono: () => performance.now(),
    lease: stores.lease,
    runs: stores.runs,
    source: o.source ?? createPayloadMomentSource({ payload: payloadOf(deps), catalog: catalogStoreOf(deps) }),
    rows: o.rows,
    alarm: o.alarm ?? createAlarm(log, deps.alarmStore),
    log,
    holderId,
    cls: 'test',
    runEpochOf: () => shared.state().runEpoch,
  });
  return { handle, holderId, leaseName };
}

/** The stored catalog narrowed to one zone and its events: a short, deterministic night. */
export function zoneSource(deps: Deps, zoneId: string): MomentSource {
  const base = createPayloadMomentSource({ payload: payloadOf(deps), catalog: catalogStoreOf(deps) });
  return {
    async load() {
      const input = await base.load();
      return { ...input, zones: input.zones.filter((z) => z.zoneId === zoneId), events: input.events.filter((e) => e.zoneId === zoneId) };
    },
  };
}

export interface ProbeCall {
  action: string;
  at: number;
  keys: string[];
  now: number;
  lateMs: number;
  runEpoch: number;
  consequenceId: string;
  /** Real ms (`Date.now`) the call began. */
  realAt: number;
  /** 1-based attempt of this consequence id. */
  attempt: number;
}

/**
 * A moment-action row that records every call into `calls`; `behave` may delay or throw (it gets
 * the call, already recorded). `classes` absent: the row exists in `test`.
 */
export function probeRow(
  key: string,
  kinds: readonly SeasonMomentKind[],
  late: LateRule,
  calls: ProbeCall[],
  behave?: (call: ProbeCall) => Promise<void>,
): MomentActionRow {
  return {
    key,
    capability: 'SPEC-07-test',
    kinds,
    late,
    async run(group: MomentActionGroup) {
      const attempt = calls.filter((c) => c.consequenceId === group.consequenceId).length + 1;
      const call: ProbeCall = {
        action: group.action,
        at: group.at,
        keys: group.moments.map((m) => m.key),
        now: group.now,
        lateMs: group.lateMs,
        runEpoch: group.runEpoch,
        consequenceId: group.consequenceId,
        realAt: Date.now(),
        attempt,
      };
      calls.push(call);
      await behave?.(call);
    },
  };
}

// ---- run analysis (AC-27, AC-30, AC-31) ---------------------------------------------------------

export interface RunCheck {
  /** (moment, action) pairs recorded, duplicates counted once. */
  pairs: number;
  duplicates: string[];
  /** Expected moments never recorded. */
  missed: string[];
  /** Recorded moments not in the expected list. */
  unexpected: string[];
  /** Adjacent recorded moments (in execution order) whose C1 order is reversed. */
  orderViolations: number;
  /** Records whose keys differ from the enumerated group of their instant (AC-30). */
  groupMismatches: { plannedAt: number; keys: string[]; expected: string[] }[];
}

/**
 * Checks one action's records (execution order = array order) against the enumerated moments it
 * should have run, all of one action: the concatenated keys must equal the C1 list.
 */
export function checkRun(records: readonly { keys: readonly string[]; plannedAt: number }[], expected: readonly SeasonMoment[]): RunCheck {
  const rank = new Map(expected.map((m, i) => [m.key, i]));
  const seen = new Map<string, number>();
  const sequence = records.flatMap((r) => r.keys);
  for (const k of sequence) seen.set(k, (seen.get(k) ?? 0) + 1);
  let orderViolations = 0;
  let prev = -1;
  for (const k of sequence) {
    const r = rank.get(k);
    if (r === undefined) continue;
    if (r < prev) orderViolations += 1;
    prev = Math.max(prev, r);
  }
  const groups = new Map<number, string[]>();
  for (const m of expected) groups.set(m.at, [...(groups.get(m.at) ?? []), m.key]);
  const groupMismatches = records
    .filter((r) => JSON.stringify(r.keys) !== JSON.stringify(groups.get(r.plannedAt) ?? []))
    .map((r) => ({ plannedAt: r.plannedAt, keys: [...r.keys], expected: groups.get(r.plannedAt) ?? [] }));
  return {
    pairs: seen.size,
    duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k),
    missed: expected.filter((m) => !seen.has(m.key)).map((m) => m.key),
    unexpected: [...seen.keys()].filter((k) => !rank.has(k)),
    orderViolations,
    groupMismatches,
  };
}
