/**
 * `pnpm run clock <status | set --at <ISO-UTC> | real | restart-night | speed <0..600> | records [--epoch N]>`
 * (SPEC-07 AC-54, AC-65 server side; C10). Ring 4 entry point, run on the node by `ops clock` and
 * `ops scheduler-drill` over SSH (`docker compose … exec -T server pnpm run clock …`): no HTTP entry.
 *
 * - Only in the classes `rehearsal` and `test` (`T2F_ENV`); any other class → exit 2 BEFORE the
 *   container is built, so no database connection is ever opened (AC-55 is the ops-side twin).
 * - Changes go through `controlClock` with the actor `ops` (one journal row each, one `clock` event).
 * - It never starts the scheduler and never takes the lease: lease and runs are only READ from the
 *   stores. It refreshes the shared clock from the database before reading it.
 * Output: the LAST non-empty stdout line is one JSON object (pnpm may print its own lines first).
 * Exit codes: 0 done, 2 refused (class, usage), 1 failed. No secret is ever printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonMoments } from '@time2fest/rules/time';
import type { SchedulerReaders } from '../adapters/processDeps';
import { pairKey } from '../domain/scheduler/consequence';
import { buildPlan, nextDueAt, type ActionRule } from '../domain/scheduler/plan';
import type { VirtualState } from '../domain/timekeeping/virtual';
import { envClass, type EnvClass, type RawEnv } from '../platform/env';
import { liveHolder } from '../scheduler/festival';
import type { RunRecordStore } from '../scheduler/recorder';
import { CLOCK_CONTROL_CLASSES, controlClock, MAX_CLOCK_SPEED, OPS_ACTOR, type ClockAction, type ClockControlDeps } from '../timekeeping/control';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const CLOCK_USAGE = 'usage: clock status | set --at <ISO-UTC> | real | restart-night | speed <0..600> | records [--epoch N]';

export type ClockCommand = { cmd: 'status' } | { cmd: 'records'; epoch?: number } | { cmd: 'control'; action: ClockAction };

/** `YYYY-MM-DDTHH:MM[:SS[.mmm]]Z` — UTC only, so an operator never sets a local time by mistake. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const UINT = /^\d{1,15}$/;

export function parseClockArgs(argv: readonly string[]): { ok: true; command: ClockCommand } | { ok: false; message: string } {
  const [verb, ...rest] = argv;
  const bad = (why: string) => ({ ok: false as const, message: `clock: ${why}; ${CLOCK_USAGE}` });
  switch (verb) {
    case 'status':
    case 'real':
    case 'restart-night':
      if (rest.length > 0) return bad(`${verb} takes no arguments`);
      return { ok: true, command: verb === 'status' ? { cmd: 'status' } : { cmd: 'control', action: { action: verb } } };
    case 'set': {
      const at = rest[0] === '--at' && rest.length === 2 ? rest[1] : undefined;
      const ms = at !== undefined && ISO_UTC.test(at) ? Date.parse(at) : NaN;
      if (!Number.isFinite(ms) || ms < 0) return bad('set needs --at <ISO-UTC>, e.g. 2026-12-31T22:59:30Z');
      return { ok: true, command: { cmd: 'control', action: { action: 'set', at: ms } } };
    }
    case 'speed': {
      const raw = rest.length === 1 ? rest[0] : undefined;
      const speed = raw !== undefined && UINT.test(raw) ? Number(raw) : NaN;
      if (!(speed >= 0 && speed <= MAX_CLOCK_SPEED)) return bad(`speed needs an integer 0..${MAX_CLOCK_SPEED}`);
      return { ok: true, command: { cmd: 'control', action: { action: 'speed', speed } } };
    }
    case 'records': {
      if (rest.length === 0) return { ok: true, command: { cmd: 'records' } };
      const raw = rest[0] === '--epoch' && rest.length === 2 ? rest[1] : undefined;
      if (raw === undefined || !UINT.test(raw)) return bad('records takes only --epoch <N>');
      return { ok: true, command: { cmd: 'records', epoch: Number(raw) } };
    }
    default:
      return bad(verb === undefined ? 'no action given' : `unknown action ${JSON.stringify(verb).slice(0, 40)}`);
  }
}

/** What the CLI needs once the class allowed it; built by `openPorts` (the container) or a test. */
export interface ClockCliPorts {
  cls: EnvClass;
  shared: { refresh(): Promise<void>; state(): VirtualState; view(): { now: number; speed: number; frozen: boolean } };
  control: ClockControlDeps;
  readers: SchedulerReaders;
  records: Pick<RunRecordStore, 'list'>;
  /** Moment-action rows of the class (`momentActionsFor`). */
  rows: readonly ActionRule[];
  close(): Promise<void>;
}

export interface ClockCliIo {
  out(line: string): void;
  err(line: string): void;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** `status`: clock, lease (read, by the database clock), next instant with its (action, moment) pairs. */
async function statusOf(p: ClockCliPorts): Promise<Record<string, unknown>> {
  const state = p.shared.state();
  const view = p.shared.view();
  const [lease, input] = await Promise.all([p.readers.lease.read(), p.readers.source.load()]);
  const ledger = await p.readers.runs.ledger(state.runEpoch);
  const plan = buildPlan(seasonMoments(input), p.rows, p.cls);
  const at = nextDueAt(plan, view.now, ledger.settled);
  let nextMoment: Record<string, unknown> | null = null;
  if (at !== null) {
    const due = plan.groups
      .filter((g) => g.at === at)
      .flatMap((g) => g.moments.filter((m) => !ledger.settled.has(pairKey(g.action, m.key))).map((m) => ({ action: g.action, key: m.key })));
    nextMoment = { key: due[0]?.key ?? null, at, atIso: iso(at), due };
  }
  return {
    class: p.cls,
    now: view.now,
    nowIso: iso(view.now),
    virtual: state.virtual,
    speed: view.speed,
    frozen: view.frozen,
    runEpoch: state.runEpoch,
    seq: state.seq,
    lease: {
      holder: liveHolder(lease),
      epoch: lease?.epoch ?? 0,
      expiresInMs: lease?.expiresInMs ?? 0,
      renewedAgoMs: lease?.renewedAgoMs ?? null,
      lastHolder: lease?.holder ?? null,
    },
    nextMoment,
  };
}

/**
 * The whole CLI over `open`. Arguments and class are checked first: a refusal (exit 2) never calls
 * `open`, so it never reaches the database.
 */
export async function runClockCli(argv: readonly string[], raw: RawEnv, io: ClockCliIo, open: () => Promise<ClockCliPorts>): Promise<number> {
  const refuse = (code: 'usage' | 'class', message: string) => {
    io.err(message);
    io.out(JSON.stringify({ ok: false, error: { code } }));
    return 2;
  };
  const parsed = parseClockArgs(argv);
  if (!parsed.ok) return refuse('usage', parsed.message);
  const cls = envClass(raw);
  if (!CLOCK_CONTROL_CLASSES.includes(cls)) return refuse('class', `clock: refused in class ${cls} (only ${CLOCK_CONTROL_CLASSES.join(', ')})`);

  const ports = await open();
  try {
    await ports.shared.refresh();
    const { command } = parsed;
    if (command.cmd === 'status') {
      io.out(JSON.stringify(await statusOf(ports)));
      return 0;
    }
    if (command.cmd === 'records') {
      const epoch = command.epoch ?? ports.shared.state().runEpoch;
      const rows = await ports.records.list(epoch);
      const records = rows.map(({ keys, action, plannedAt, startedAt, at, consequenceId }) => ({ keys, action, plannedAt, startedAt, at, consequenceId }));
      io.out(JSON.stringify({ epoch, records }));
      return 0;
    }
    const result = await controlClock(ports.control, 'ops', OPS_ACTOR, command.action);
    if (!result.ok) return refuse(result.code === 'validation' ? 'usage' : 'class', `clock: ${command.action.action} refused (${result.code})`);
    const v = result.value;
    io.out(JSON.stringify({ action: command.action.action, ...v, nowIso: iso(v.now), runEpoch: v.epoch }));
    return 0;
  } finally {
    await ports.close();
  }
}

/** The real ports: the process container (scheduler built, never started), stores over its Payload. */
async function openPorts(raw: RawEnv): Promise<ClockCliPorts> {
  const [{ createDeps, payloadOf }, { clockControlDepsOf, schedulerReadersOf }, { momentActionsFor }, { createPayloadRunRecordStore }] = await Promise.all([
    import('../container'),
    import('../adapters/processDeps'),
    import('../registries/moments'),
    import('../adapters/payloadRunRecords'),
  ]);
  const deps = createDeps(raw);
  const shared = deps.sharedClock;
  const control = clockControlDepsOf(deps);
  if (!shared || !control) throw new Error('clock: no shared clock in this class');
  const payload = payloadOf(deps);
  return {
    cls: deps.env.class,
    shared: { refresh: () => shared.refresh(), state: () => shared.state(), view: () => shared.view() },
    control,
    readers: schedulerReadersOf(deps, payload),
    records: createPayloadRunRecordStore(payload),
    rows: momentActionsFor(deps.env.class),
    close: () =>
      payload()
        .then((p) => p.destroy())
        .catch(() => undefined),
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const envFile = path.join(serverDir, '.env.local');
  // The local file only fills in a shell that has no database configured (the node's container brings its own environment).
  if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const io: ClockCliIo = { out: (l) => process.stdout.write(`${l}\n`), err: (l) => process.stderr.write(`${l}\n`) };
  return runClockCli(argv, process.env, io, () => openPorts(process.env));
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      // The error name only: a message may carry a connection string.
      process.stderr.write(`clock: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'failed' } })}\n`);
      process.exit(1);
    },
  );
}
