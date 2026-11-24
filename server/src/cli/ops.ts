/**
 * `pnpm run ops <command>` — серверні команди оператора (SPEC-13b [А17], [П-7]; W35, W36). Ring 4, запускає
 * оператор на вузлі (або разова копія образу для `restore-pull`):
 *
 *   status                                  огляд моніторингу JSON (та сама схема, що й `/cms-api/ops/overview`), нічого не пише (AC-38)
 *   backup-now                              позачергова копія `manual` з тими самими захистами й орендою `ops-backup`; друкує ключ і маніфест (AC-52)
 *   restore-record --at <ISO> --key <k> --duration-ms <n> [--loss-ms <n>] --result ok|failed --target <t>
 *                                           рядок `restore-runs` + рядок журналу (AC-56)
 *   spend-record server --hours <n> --usd-per-hour <r> --reason <text ≤200>
 *                                           години розміру вузла в рядок витрат `server` + рядок журналу (AC-63)
 *   restore-pull [--key <ключ|штамп|latest>] [--manifest-only]
 *                                           (`--manifest-only`: маніфест + `snapshots` — моменти всіх копій префікса)
 *                                           завантажити копію, перевірити sha256 і id ключа, розшифрувати потоком у
 *                                           `pg_restore` ПОРОЖНЬОЇ цілі (AC-53, AC-55, AC-59). Читає лише `T2F_R2_*`,
 *                                           `T2F_BACKUP_KEY`, `DATABASE_URI`, `T2F_RESTORE_TMP`, `T2F_ENV`.
 *
 * Вихід: 0 — зроблено; 2 — відмова (аргументи, середовище, ціль не порожня, оренда зайнята, копія не налаштована);
 * 3 — перевірка копії не пройшла (`sha256|key-id|auth|size`, тимчасові файли прибрано); 1 — збій. Жодне значення
 * середовища, рядок підключення чи текст помилки (може містити хост або користувача) не друкується; пароль бази
 * доходить до `pg_restore` лише змінною середовища дитини.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import pg from 'pg';
import { childEnvOf, pgEnvOf, type DumpCommand } from '../adapters/pgDump';
import { createS3ObjectStore } from '../adapters/s3';
import type { ObjectStore } from '../catalog/ports';
import { monthPeriod } from '../domain/ops/spend';
import type { Deps } from '../endpoints/types';
import { PRODUCTION_DENYLIST, envClass, type RawEnv } from '../platform/env';
import { parseBackupKey } from '../ops/backupFormat';
import { OverviewSchema } from '../ops/overviewSchema';
import type { RestoreRun } from '../ops/ports';
import { backupsPrefixOf, type BackupOutcome } from '../ops/backup';
import { manifestKeyOf, pullManifest, restorePull, type RestorePullDeps, type RestorePullRun, type RestoreRunner, type RestoreTarget } from '../ops/restorePull';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const OPS_USAGE =
  'usage: ops status | backup-now | restore-record --at <ISO> --key <k> --duration-ms <n> [--loss-ms <n>] --result ok|failed --target <t> | ' +
  'spend-record server --hours <n> --usd-per-hour <r> --reason <text> | restore-pull [--key <k|latest>] [--manifest-only]';

export const RESTORE_RECORD_ACTION = 'ops.restore-record';
export const SPEND_RECORD_ACTION = 'ops.spend-record';
const REASON_MAX = 200;
const OBJECT_KEY = /^[A-Za-z0-9_.:/-]{1,512}$/;
const TARGET = /^[A-Za-z0-9_.:-]{1,64}$/;
const BACKUP_REF = /^(latest|\d{8}T\d{6}Z|[A-Za-z0-9_.:/-]{1,512})$/;
const hasControl = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
/** `pg_restore` arguments; the connection is the child's environment, `-d` names the database only. */
/** How long `backup-now` waits after a non-ok copy before closing, so the alarm's outbox row is written. */
export const ALARM_SETTLE_MS = 3_000;
export const PG_RESTORE_ARGS: readonly string[] = ['--no-owner', '--exit-on-error'];

export type OpsCommand =
  | { cmd: 'status' }
  | { cmd: 'backup-now' }
  | { cmd: 'restore-record'; run: RestoreRun }
  | { cmd: 'spend-record'; hours: number; usdPerHour: number; reason: string }
  | { cmd: 'restore-pull'; ref: string; manifestOnly: boolean };

type Parsed = { ok: true; command: OpsCommand } | { ok: false; message: string };

/** `--name value` pairs and bare `--switch`es; unknown or repeated flags refuse. */
function flagsOf(args: readonly string[], valued: readonly string[], switches: readonly string[] = []): Map<string, string> | string {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const name = a.startsWith('--') ? a.slice(2) : '';
    if (!name || out.has(name)) return `unexpected argument ${JSON.stringify(a.slice(0, 40))}`;
    if (switches.includes(name)) {
      out.set(name, '');
      continue;
    }
    if (!valued.includes(name)) return `unknown flag --${name.slice(0, 40)}`;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) return `--${name} needs a value`;
    out.set(name, v);
    i++;
  }
  return out;
}

const nonNegInt = (v: string | undefined): number | null => (v !== undefined && /^\d{1,12}$/.test(v) ? Number(v) : null);
const nonNegNumber = (v: string | undefined, max: number): number | null => {
  if (v === undefined || !/^\d{1,6}(\.\d{1,6})?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

export function parseOpsArgs(argv: readonly string[]): Parsed {
  const bad = (why: string): Parsed => ({ ok: false, message: `ops: ${why}; ${OPS_USAGE}` });
  const [verb, ...rest] = argv;
  switch (verb) {
    case 'status':
    case 'backup-now':
      return rest.length === 0 ? { ok: true, command: { cmd: verb } } : bad(`${verb} takes no arguments`);
    case 'restore-record': {
      const f = flagsOf(rest, ['at', 'key', 'duration-ms', 'loss-ms', 'result', 'target']);
      if (typeof f === 'string') return bad(f);
      const at = Date.parse(f.get('at') ?? '');
      if (!/^\d{4}-\d{2}-\d{2}T/.test(f.get('at') ?? '') || !Number.isFinite(at)) return bad('--at must be an ISO date-time');
      const key = f.get('key') ?? '';
      if (!OBJECT_KEY.test(key)) return bad('--key must be an object key');
      const durationMs = nonNegInt(f.get('duration-ms'));
      if (durationMs === null) return bad('--duration-ms must be a whole number of ms');
      const lossRaw = f.get('loss-ms');
      const lossWindowMs = lossRaw === undefined ? null : nonNegInt(lossRaw);
      if (lossRaw !== undefined && lossWindowMs === null) return bad('--loss-ms must be a whole number of ms');
      const result = f.get('result');
      if (result !== 'ok' && result !== 'failed') return bad('--result must be ok or failed');
      const target = f.get('target') ?? '';
      if (!TARGET.test(target)) return bad('--target must be a short name');
      return { ok: true, command: { cmd: 'restore-record', run: { at, source: key, durationMs, lossWindowMs, result, target } } };
    }
    case 'spend-record': {
      const [row, ...flags] = rest;
      if (row !== 'server') return bad('spend-record records the server row only');
      const f = flagsOf(flags, ['hours', 'usd-per-hour', 'reason']);
      if (typeof f === 'string') return bad(f);
      const hours = nonNegNumber(f.get('hours'), 10_000);
      if (hours === null) return bad('--hours must be a number 0 … 10000');
      const usdPerHour = nonNegNumber(f.get('usd-per-hour'), 1_000);
      if (usdPerHour === null) return bad('--usd-per-hour must be a number 0 … 1000');
      const reason = (f.get('reason') ?? '').trim();
      if (reason.length < 1 || reason.length > REASON_MAX || hasControl(reason)) return bad(`--reason must be 1 … ${REASON_MAX} characters`);
      return { ok: true, command: { cmd: 'spend-record', hours, usdPerHour, reason } };
    }
    case 'restore-pull': {
      const f = flagsOf(rest, ['key'], ['manifest-only']);
      if (typeof f === 'string') return bad(f);
      const ref = f.get('key') ?? 'latest';
      if (!BACKUP_REF.test(ref)) return bad('--key must be a backup key, a stamp or latest');
      return { ok: true, command: { cmd: 'restore-pull', ref, manifestOnly: f.has('manifest-only') } };
    }
    default:
      return bad('unknown command');
  }
}

/** What the commands other than `restore-pull` need: the process deps, opened lazily. */
export interface OpsCliPorts {
  status(): Promise<unknown>;
  backupNow(now: number): Promise<BackupOutcome | { result: 'held-elsewhere' }>;
  recordRestore(run: RestoreRun, now: number): Promise<void>;
  recordSpend(hours: number, usdPerHour: number, reason: string, now: number): Promise<void>;
  close(): Promise<void>;
}

/** `restore-pull`'s own ports: the source bucket, the key, the target and the temp root (no `createDeps`). */
export type RestorePullPorts = { manifestOnly: true; deps: RestorePullDeps } | { manifestOnly: false; run: Omit<RestorePullRun, 'onTemp'> };

export interface OpsCliIo {
  out(line: string): void;
  err(line: string): void;
}

export interface OpsCliDeps {
  open(): Promise<OpsCliPorts>;
  /** Builds the restore ports from the environment; a string = the refusal (names of variables only). */
  openRestore(manifestOnly: boolean): RestorePullPorts | string;
  now(): number;
  /** The temp dir of a running pull (for the signal cleanup of `main`). */
  onTemp?(dir: string | null): void;
}

const MANIFEST_STAMP = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.manifest\.json$/;

/** ISO moments of the manifests under `<prefix>backups/db/`, oldest first (the stamp is the snapshot start). */
export async function snapshotsOf(deps: RestorePullDeps): Promise<string[]> {
  if (!deps.store.list) return [];
  const out: string[] = [];
  for (const { key } of await deps.store.list(backupsPrefixOf(deps.prefix))) {
    if (manifestKeyOf(deps.prefix, key) !== key) continue;
    const m = MANIFEST_STAMP.exec(key);
    if (m) out.push(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`);
  }
  return out.sort();
}

async function runRestorePull(command: Extract<OpsCommand, { cmd: 'restore-pull' }>, io: OpsCliIo, deps: OpsCliDeps): Promise<number> {
  const ports = deps.openRestore(command.manifestOnly);
  if (typeof ports === 'string') {
    io.err(`ops: restore-pull refused (${ports})`);
    return 2;
  }
  if (ports.manifestOnly) {
    const found = await pullManifest(ports.deps, command.ref);
    if (found.result !== 'ok') {
      io.err(`ops: restore-pull ${found.result}`);
      return found.result === 'bad-manifest' ? 1 : 2;
    }
    // Snapshot moments of every copy under the prefix (a manifest exists only after a successful copy): the
    // operator's `restore:env` computes the loss window from them (AC-57, [А16]) without a second listing.
    const snapshots = await snapshotsOf(ports.deps);
    io.out(JSON.stringify({ ok: true, manifestKey: found.manifestKey, manifest: found.manifest, snapshots }));
    return 0;
  }
  const out = await restorePull({ ...ports.run, ...(deps.onTemp ? { onTemp: deps.onTemp } : {}) }, command.ref);
  switch (out.result) {
    case 'ok':
      io.out(JSON.stringify({ ok: true, key: out.manifest.key, manifestKey: out.manifestKey, durationMs: out.durationMs, manifest: out.manifest }));
      return 0;
    case 'verify-failed':
      io.err(`ops: restore-pull verify failed (${out.reason})`);
      return 3;
    case 'target-not-empty':
    case 'not-found':
    case 'bad-ref':
      io.err(`ops: restore-pull refused (${out.result})`);
      return 2;
    default:
      io.err(`ops: restore-pull failed (${out.result})`);
      return 1;
  }
}

export async function runOps(argv: readonly string[], io: OpsCliIo, deps: OpsCliDeps): Promise<number> {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 2;
  }
  const command = parsed.command;
  if (command.cmd === 'restore-pull') return runRestorePull(command, io, deps);

  const ports = await deps.open();
  try {
    const now = deps.now();
    switch (command.cmd) {
      case 'status': {
        const checked = OverviewSchema.safeParse(await ports.status());
        if (!checked.success) {
          io.err('ops: status does not match the overview schema');
          return 1;
        }
        io.out(JSON.stringify(checked.data));
        return 0;
      }
      case 'backup-now': {
        const out = await ports.backupNow(now);
        if (out.result === 'ok') {
          io.out(JSON.stringify({ ok: true, key: out.key, manifest: out.manifest }));
          return 0;
        }
        if (out.result === 'failed') {
          io.err(`ops: backup failed (stage ${out.stage})`);
          return 1;
        }
        io.err(`ops: backup refused (${out.result === 'off' ? 'not-configured' : out.result === 'refused' ? out.reason : 'lease held elsewhere'})`);
        return 2;
      }
      case 'restore-record':
        await ports.recordRestore(command.run, now);
        io.out(JSON.stringify({ ok: true, recorded: 'restore-runs', at: new Date(command.run.at).toISOString(), result: command.run.result }));
        return 0;
      case 'spend-record':
        await ports.recordSpend(command.hours, command.usdPerHour, command.reason, now);
        io.out(JSON.stringify({ ok: true, recorded: 'server', period: monthPeriod(now), hours: command.hours, usd: command.hours * command.usdPerHour }));
        return 0;
    }
  } finally {
    await ports.close();
  }
}

/** The ports of the commands over the process deps (the same stores the runner and the overview use). */
export async function opsPortsOf(deps: Deps): Promise<OpsCliPorts> {
  const [container, payloadOps, journalMod, revert, backupMod, spendMod, overviewMod, sourcesMod] = await Promise.all([
    import('../container'),
    import('../adapters/payloadOps'),
    import('../adapters/payloadJournal'),
    import('../registries/revertHandlers'),
    import('../ops/backup'),
    import('../ops/spend'),
    import('../ops/overview'),
    import('../adapters/overviewSources'),
  ]);
  const payload = container.payloadOf(deps);
  const journalOf = (collection: string) =>
    payloadOps.createPayloadOpsJournal({ payload, journal: journalMod.createPayloadJournal(revert.isRevertible), collection });
  return {
    status: async () => overviewMod.buildOverview(await sourcesMod.overviewSourcesOf(deps)),
    async backupNow(now) {
      const lease = deps.ops?.lease;
      if (!lease) throw new Error('ops not wired');
      // The same lease as the scheduled copy: never two copies at once across the cluster (AC-52).
      if (!(await lease.acquire('ops-backup', backupMod.BACKUP_LEASE_MS))) return { result: 'held-elsewhere' };
      const renew = setInterval(() => lease.acquire('ops-backup', backupMod.BACKUP_LEASE_MS).catch(() => undefined), backupMod.BACKUP_LEASE_MS / 3);
      renew.unref?.();
      try {
        const out = await backupMod.runBackup(container.backupDepsOf(deps), now, 'manual');
        // A failed or unconfigured copy raises a `page` alarm whose outbox insert is fire-and-forget; the CLI exits
        // right after `close()`, so it gives that insert a bounded moment to land first (I1 note of S11).
        if (out.result !== 'ok') await new Promise((resolve) => setTimeout(resolve, ALARM_SETTLE_MS));
        return out;
      } finally {
        clearInterval(renew);
        await lease.release('ops-backup').catch(() => undefined);
      }
    },
    async recordRestore(run, now) {
      await payloadOps.createPayloadRestoreRuns(payload).record(run);
      await journalOf('restore-runs').line(
        RESTORE_RECORD_ACTION,
        run.source,
        { at: new Date(run.at).toISOString(), result: run.result, durationMs: run.durationMs, lossWindowMs: run.lossWindowMs, target: run.target },
        now,
      );
    },
    async recordSpend(hours, usdPerHour, reason, now) {
      // `capacity night` records 0 h with the hourly rate ([П-6]): a journal line, no counter change.
      if (hours > 0) await spendMod.recordServerHours(payloadOps.createPayloadSpendCounters(payload), hours, usdPerHour, now);
      await journalOf('spend-counters').line(SPEND_RECORD_ACTION, `server:${monthPeriod(now)}`, { hours, usdPerHour, reason }, now);
    },
    close: () =>
      payload()
        .then((p) => p.destroy())
        .catch(() => undefined),
  };
}

/** Runs `pg_restore` per `spec` with `input` on stdin; non-zero exit → rejects (code only; stderr counted, never logged). */
export function runRestoreSpec(spec: DumpCommand, input: Readable, onChild?: (kill: (() => void) | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.cmd, spec.args, { env: childEnvOf(spec.env), stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    onChild?.(() => child.kill());
    let stderrBytes = 0;
    let inputError: unknown;
    child.stderr.on('data', (d: Buffer) => (stderrBytes += d.length));
    // EPIPE when pg_restore exits early: its exit code is the answer.
    child.stdin.on('error', () => undefined);
    input.on('error', (err) => {
      inputError = err;
      child.kill();
    });
    input.pipe(child.stdin);
    child.on('error', (err) => {
      onChild?.(null);
      reject(new Error(`pg_restore: cannot start ${spec.cmd} (${(err as NodeJS.ErrnoException).code ?? 'error'})`));
    });
    child.on('close', (code, signal) => {
      onChild?.(null);
      if (inputError !== undefined) reject(inputError);
      else if (code === 0) resolve();
      else reject(new Error(`pg_restore: exited with ${code === null ? String(signal) : String(code)} (stderr ${stderrBytes} bytes)`));
    });
  });
}

/** The local `pg_restore` into the database of `databaseUri` (connection in the child's environment only). */
export function pgRestoreSpecOf(databaseUri: string): DumpCommand {
  const env = pgEnvOf(databaseUri);
  return { cmd: 'pg_restore', args: [...PG_RESTORE_ARGS, '-d', env.PGDATABASE ?? ''], env };
}

export function createPgRestoreRunner(databaseUri: string, onChild?: (kill: (() => void) | null) => void): RestoreRunner {
  return { restore: (input) => runRestoreSpec(pgRestoreSpecOf(databaseUri), input, onChild) };
}

/** The target is empty when it has no relation outside the system schemas. */
export function createPgRestoreTarget(databaseUri: string): RestoreTarget {
  return {
    async isEmpty() {
      const client = new pg.Client({ connectionString: databaseUri });
      await client.connect();
      try {
        const r = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname NOT IN ('pg_catalog', 'information_schema') AND s.nspname NOT LIKE 'pg_toast%' AND s.nspname NOT LIKE 'pg_temp%'
             AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
        );
        return (r.rows[0]?.n ?? 1) === 0;
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

const R2_VARS = ['T2F_R2_ENDPOINT', 'T2F_R2_BUCKET', 'T2F_R2_ACCESS_KEY_ID', 'T2F_R2_SECRET_ACCESS_KEY', 'T2F_R2_PREFIX'] as const;

/**
 * The restore ports from the raw environment ([П-7]: only the variables the pull needs, not `env.check`). The full
 * pull refuses the production class and a production-named target database. `store` is injectable (tests).
 */
export function restorePortsOf(
  raw: RawEnv,
  manifestOnly: boolean,
  make: { store?: (vars: Record<(typeof R2_VARS)[number], string>) => ObjectStore; runner?: (databaseUri: string) => RestoreRunner; target?: (databaseUri: string) => RestoreTarget; now?: () => number } = {},
): RestorePullPorts | string {
  const needed = manifestOnly ? [...R2_VARS] : [...R2_VARS, 'T2F_BACKUP_KEY', 'DATABASE_URI', 'T2F_RESTORE_TMP'];
  const missing = needed.filter((n) => !raw[n]);
  if (missing.length > 0) return `missing ${missing.join(', ')}`;
  const r2 = Object.fromEntries(R2_VARS.map((n) => [n, String(raw[n])])) as Record<(typeof R2_VARS)[number], string>;
  const now = make.now ?? Date.now;
  const store =
    make.store?.(r2) ??
    createS3ObjectStore({ endpoint: r2.T2F_R2_ENDPOINT, bucket: r2.T2F_R2_BUCKET, accessKeyId: r2.T2F_R2_ACCESS_KEY_ID, secretAccessKey: r2.T2F_R2_SECRET_ACCESS_KEY });
  const base: RestorePullDeps = { store, prefix: r2.T2F_R2_PREFIX, now };
  if (manifestOnly) return { manifestOnly: true, deps: base };

  if (envClass(raw) === 'production') return 'T2F_ENV must be test or rehearsal';
  const databaseUri = String(raw.DATABASE_URI);
  let dbName: string;
  try {
    dbName = pgEnvOf(databaseUri).PGDATABASE ?? '';
  } catch {
    return 'DATABASE_URI is not a postgres URI';
  }
  const lowered = databaseUri.toLowerCase();
  if (!dbName || PRODUCTION_DENYLIST.some((p) => lowered.includes(p.toLowerCase()))) return 'DATABASE_URI names a production database';
  let key: Buffer;
  try {
    key = parseBackupKey(String(raw.T2F_BACKUP_KEY));
  } catch {
    return 'T2F_BACKUP_KEY is not a 32-byte base64 key';
  }
  const tmpRoot = path.resolve(String(raw.T2F_RESTORE_TMP));
  if (!fs.existsSync(tmpRoot) || !fs.statSync(tmpRoot).isDirectory()) return 'T2F_RESTORE_TMP is not a directory';
  return {
    manifestOnly: false,
    run: {
      ...base,
      key,
      tmpRoot,
      target: make.target?.(databaseUri) ?? createPgRestoreTarget(databaseUri),
      runner: make.runner?.(databaseUri) ?? createPgRestoreRunner(databaseUri),
    },
  };
}

async function main(): Promise<number> {
  const envFile = path.join(serverDir, '.env.local');
  if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);

  // Signal cleanup of a running pull (AC-59): kill `pg_restore`, remove the temp dir, exit 130.
  let tempDir: string | null = null;
  let killChild: (() => void) | null = null;
  const onSignal = () => {
    killChild?.();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return runOps(
    process.argv.slice(2),
    { out: (l) => process.stdout.write(`${l}\n`), err: (l) => process.stderr.write(`${l}\n`) },
    {
      open: async () => {
        const { createDeps } = await import('../container');
        return opsPortsOf(createDeps(process.env));
      },
      openRestore: (manifestOnly) =>
        restorePortsOf(process.env, manifestOnly, {
          runner: (uri) =>
            createPgRestoreRunner(uri, (kill) => {
              killChild = kill;
            }),
        }),
      now: Date.now,
      onTemp: (dir) => {
        tempDir = dir;
      },
    },
  );
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`ops: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.exit(1);
    },
  );
}
