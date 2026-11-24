/**
 * Резервна копія бази (SPEC-13b AC-40 … AC-45, AC-48, AC-51, NFR-3, NFR-4), ring 3.
 *
 * `runBackup` — одна копія: спершу захисти (немає ключа чи R2 → один `page` `ops/backup-not-configured` на
 * процес у `rehearsal` / `production`; клас `test` з R2 не на loopback → відмова; мажор `pg_dump` ≠ мажор сервера
 * → `page` `ops/backup-failed` `{stage:'version'}`), далі потік `pg_dump` → `encryptStream` (T2FB1) → sha256 і
 * розмір → `putMultipart(<prefix>backups/db/<yyyymmddThhmmssZ>.dump.enc)` з протиском (`pipeline`), і лише
 * ПІСЛЯ нього — `<…>.manifest.json`. Будь-яка невдача → вивантаження перервано (адаптер абортує multipart),
 * маніфесту немає, `page` `ops/backup-failed` з етапом, рядок журналу `ops.backup-failed`. Кожен запуск — рядок
 * `backup-runs`. На диск не пишеться нічого; ключ і його значення ніколи не потрапляють у маніфест, журнал чи лог
 * (лише id ключа).
 *
 * `createBackupJob` — розклад (AC-40): слот `backupSlotAt` під орендою `ops-backup`, один на кластер (слот
 * зайнятий, якщо є рядок `backup-runs` за розкладом із `snapshotAt ≥ due`); після вдалої копії — зберігання
 * (AC-46); перевірка застарілості раз на 10 хв (AC-45).
 */
import { createHash } from 'node:crypto';
import { Transform, pipeline, type Readable } from 'node:stream';
import type { ObjectStore } from '../catalog/ports';
import { backupStamp } from '../domain/ops/retention';
import { backupSlotAt, inHourlyBackupWindow, isBackupStale, staleThresholdMs } from '../domain/ops/schedule';
import type { EnvClass } from '../platform/env';
import type { Alarm, Logger } from '../ports';
import { BACKUP_MAGIC, encryptStream } from './backupFormat';
import type { BackupRun, BackupRunStore, BackupStage, DumpRunner, OpsJournal, OpsLease, WallClock } from './ports';
import { runRetention } from './retention';

export const BACKUP_FAILED_ACTION = 'ops.backup-failed';
/** Lease term of `ops-backup`; renewed every third of it while a copy runs. */
export const BACKUP_LEASE_MS = 60_000;
export const STALE_CHECK_EVERY_MS = 600_000;
const MANIFEST_TYPE = 'application/json';
const DUMP_TYPE = 'application/octet-stream';
/** Multipart above 16 MB (AC-43); the adapter's default, repeated here so ring 3 does not import an adapter. */
export const BACKUP_PART_BYTES = 16 * 1024 * 1024;

/** `<T2F_R2_PREFIX>backups/db/` — the only place copies are written and deleted (AC-48, AC-46). */
export function backupsPrefixOf(envPrefix: string): string {
  return `${envPrefix}backups/db/`;
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** The manifest written after the dump object (AC-43). Never carries the key, only its id. */
export interface BackupManifest {
  format: typeof BACKUP_MAGIC;
  key: string;
  size: number;
  sha256: string;
  keyId: string;
  /** ISO of the snapshot start (the dump spawn). */
  snapshotAt: string;
  durationMs: number;
  pgVersion: number;
  lastMigration: string | null;
  rowCounts: Record<string, number>;
  commit: string | null;
}

/** What the copy needs from the environment; `null` key or store — not configured (AC-48). */
export interface BackupConfig {
  key: Buffer | null;
  keyId: string | null;
  /** Metered store of the environment's bucket (`putMultipart`, `put`, `list`, `delete`). */
  store: ObjectStore | null;
  /** `T2F_R2_PREFIX`. */
  prefix: string;
  /** `T2F_R2_ENDPOINT` (class `test`: loopback only). */
  endpoint: string | null;
  dump: DumpRunner;
  commit: string | null;
  /** Part size of the multipart upload (default of the adapter: 16 MB). */
  partBytes?: number;
}

export interface BackupDeps {
  config: BackupConfig;
  cls: EnvClass;
  alarm: Alarm;
  log: Logger;
  journal: OpsJournal;
  runs: BackupRunStore;
  facts: { lastMigration(): Promise<string | null>; rowCounts(): Promise<Record<string, number>> };
  /** Durations only; the snapshot time is the caller's `now`. */
  clock: WallClock;
}

export type BackupKind = BackupRun['kind'];

export type BackupOutcome =
  | { result: 'ok'; key: string; manifest: BackupManifest; retention?: { deleted: number } | { failed: true } }
  | { result: 'failed'; stage: BackupStage; key: string }
  | { result: 'off'; reason: 'not-configured' }
  | { result: 'refused'; reason: 'non-loopback' };

type UploadStore = ObjectStore & { putMultipart: NonNullable<ObjectStore['putMultipart']> };
type Guard = { ok: true; key: Buffer; keyId: string; store: UploadStore } | { ok: false; outcome: BackupOutcome };

/** Захисти до будь-якої роботи (AC-48). `notConfigured` викликається, коли копія не налаштована. */
function guardOf(deps: BackupDeps, notConfigured: () => void): Guard {
  const { config, cls } = deps;
  const store = config.store;
  if (!config.key || !config.keyId || !store || !store.putMultipart) {
    notConfigured();
    return { ok: false, outcome: { result: 'off', reason: 'not-configured' } };
  }
  if (cls === 'test' && (!config.endpoint || !isLoopbackEndpoint(config.endpoint))) {
    return { ok: false, outcome: { result: 'refused', reason: 'non-loopback' } };
  }
  return { ok: true, key: config.key, keyId: config.keyId, store: store as UploadStore };
}

function causeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; name?: unknown };
  const v = typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : undefined;
  return v && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : undefined;
}

const isPrematureClose = (err: unknown) => (err as { code?: unknown } | null)?.code === 'ERR_STREAM_PREMATURE_CLOSE';

/**
 * One copy at `now` (the snapshot time, also the object name). `notConfigured` is the caller's once-per-process
 * alarm (`createBackupJob`); the CLI passes its own.
 */
export async function runBackup(
  deps: BackupDeps,
  now: number,
  kind: BackupKind,
  notConfigured: () => void = () => {},
): Promise<BackupOutcome> {
  const guard = guardOf(deps, notConfigured);
  if (!guard.ok) return guard.outcome;
  const { key, keyId, store } = guard;
  const { config } = deps;
  const started = deps.clock.now();
  const base = `${backupsPrefixOf(config.prefix)}${backupStamp(now)}`;
  const dumpKey = `${base}.dump.enc`;
  const manifestKey = `${base}.manifest.json`;
  const elapsed = () => Math.max(0, deps.clock.now() - started);

  // `cause` is logged by error name / code only (`EntityTooSmall`, `ECONNREFUSED`): never a message, which may
  // carry a host or a user.
  const fail = async (stage: BackupStage, cause?: unknown): Promise<BackupOutcome> => {
    deps.alarm.raise({ level: 'page', source: 'ops', code: 'backup-failed', details: { stage } });
    deps.log.warn({ event: 'ops/backup-failed', stage, cause: causeOf(cause) });
    await deps.journal.line(BACKUP_FAILED_ACTION, dumpKey, { stage, kind }, now).catch(() => deps.log.warn({ event: 'ops/backup-journal-failed' }));
    await deps.runs
      .record({ key: dumpKey, kind, result: 'failed', stage, durationMs: elapsed(), snapshotAt: now, keyId })
      .catch(() => deps.log.warn({ event: 'ops/backup-run-record-failed' }));
    return { result: 'failed', stage, key: dumpKey };
  };

  // AC-42: the client and the server must share a major version; an unreadable version is the same failure.
  let pgVersion: number;
  try {
    const [client, server] = await Promise.all([config.dump.version(), config.dump.serverVersion()]);
    if (!Number.isFinite(client) || !Number.isFinite(server) || client !== server) return fail('version');
    pgVersion = server;
  } catch {
    return fail('version');
  }

  let lastMigration: string | null;
  let rowCounts: Record<string, number>;
  try {
    [lastMigration, rowCounts] = await Promise.all([deps.facts.lastMigration(), deps.facts.rowCounts()]);
  } catch {
    return fail('dump');
  }

  // pg_dump → T2FB1 → sha256/size → multipart. The first real error names the stage; a premature close is only
  // the echo of another stream's failure.
  let firstStage: BackupStage | undefined;
  const mark = (stage: BackupStage) => (err: unknown) => {
    if (firstStage === undefined && !isPrematureClose(err)) firstStage = stage;
  };
  const hash = createHash('sha256');
  let tapped = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      tapped += chunk.length;
      cb(null, chunk);
    },
  });
  let source: Readable;
  try {
    source = config.dump.dump();
  } catch {
    return fail('dump');
  }
  const enc = encryptStream(key, keyId);
  source.on('error', mark('dump'));
  enc.on('error', mark('encrypt'));
  pipeline(source, enc, tap, () => undefined);
  let size: number;
  try {
    ({ size } = await store.putMultipart(dumpKey, tap, DUMP_TYPE, config.partBytes ?? BACKUP_PART_BYTES));
  } catch (err) {
    if (!source.destroyed) source.destroy();
    return fail(firstStage ?? 'upload', err);
  }
  if (firstStage !== undefined) return fail(firstStage);
  if (size !== tapped) return fail('upload');
  const sha256 = hash.digest('hex');
  const durationMs = elapsed();

  const manifest: BackupManifest = {
    format: BACKUP_MAGIC,
    key: dumpKey,
    size,
    sha256,
    keyId,
    snapshotAt: new Date(now).toISOString(),
    durationMs,
    pgVersion,
    lastMigration,
    rowCounts,
    commit: config.commit,
  };
  try {
    await store.put(manifestKey, JSON.stringify(manifest, null, 2), MANIFEST_TYPE);
  } catch {
    // A dump without its manifest is not a copy (AC-44); best effort, never anything outside our own key.
    await store.delete?.(dumpKey).catch(() => undefined);
    return fail('manifest');
  }
  await deps.runs
    .record({ key: dumpKey, kind, result: 'ok', size, sha256, durationMs, snapshotAt: now, keyId })
    .catch(() => deps.log.warn({ event: 'ops/backup-run-record-failed' }));
  deps.log.info({ event: 'ops/backup-ok', key: dumpKey, size, durationMs });

  let retention: { deleted: number } | { failed: true } | undefined;
  if (store.list && store.delete) {
    retention = await runRetention({ store, backupsPrefix: backupsPrefixOf(config.prefix), journal: deps.journal }, now).catch(() => {
      deps.alarm.raise({ level: 'page', source: 'ops', code: 'backup-failed', details: { stage: 'retention' } });
      return { failed: true } as const;
    });
  }
  return { result: 'ok', key: dumpKey, manifest, ...(retention ? { retention } : {}) };
}

export type BackupJobOutcome =
  | BackupOutcome
  | { result: 'idle' }
  | { result: 'running' }
  | { result: 'held-elsewhere' }
  | { result: 'stale'; ageMinutes: number | null }
  | { result: 'fresh' };

export interface BackupJob {
  /** The scheduled copy of the slot at `now`, under `ops-backup` (AC-40). */
  scheduled(now: number): Promise<BackupJobOutcome>;
  /** `page` `ops/backup-stale` while the newest ok copy is too old; at most once per 10 min per process (AC-45). */
  staleCheck(now: number): Promise<BackupJobOutcome>;
  /** True while a copy of this process runs. */
  busy(): boolean;
  release(): Promise<void>;
}

export interface BackupJobDeps extends BackupDeps {
  lease: OpsLease;
}

export function createBackupJob(deps: BackupJobDeps): BackupJob {
  let notConfiguredRaised = false;
  const notConfigured = () => {
    // AC-48: once per process, in the classes that must have backups; `test` without a key just does nothing.
    if (notConfiguredRaised || deps.cls === 'test') return;
    notConfiguredRaised = true;
    deps.alarm.raise({ level: 'page', source: 'ops', code: 'backup-not-configured' });
  };
  const doneSlots = new Set<string>();
  let running = false;
  let lastStaleCheck: number | undefined;
  let firstSeen: number | undefined;
  const configured = () => {
    const c = deps.config;
    return Boolean(c.key && c.keyId && c.store?.putMultipart);
  };

  return {
    busy: () => running,
    async scheduled(now) {
      if (!configured()) {
        notConfigured();
        return { result: 'off', reason: 'not-configured' };
      }
      const slot = backupSlotAt(now);
      if (doneSlots.has(slot.key)) return { result: 'idle' };
      if (running) return { result: 'running' };
      running = true;
      try {
        if (!(await deps.lease.acquire('ops-backup', BACKUP_LEASE_MS))) return { result: 'held-elsewhere' };
        if (await deps.runs.scheduledSince(slot.due)) {
          doneSlots.add(slot.key);
          return { result: 'idle' };
        }
        const renew = setInterval(() => {
          deps.lease.acquire('ops-backup', BACKUP_LEASE_MS).catch(() => undefined);
        }, BACKUP_LEASE_MS / 3);
        renew.unref?.();
        try {
          const out = await runBackup(deps, now, inHourlyBackupWindow(slot.due) ? 'hourly' : 'daily', notConfigured);
          if (out.result === 'ok' || out.result === 'failed') doneSlots.add(slot.key);
          return out;
        } finally {
          clearInterval(renew);
          await deps.lease.release('ops-backup').catch(() => undefined);
        }
      } finally {
        running = false;
      }
    },
    async staleCheck(now) {
      if (!configured()) return { result: 'off', reason: 'not-configured' };
      firstSeen ??= now;
      if (lastStaleCheck !== undefined && Math.abs(now - lastStaleCheck) < STALE_CHECK_EVERY_MS) return { result: 'idle' };
      lastStaleCheck = now;
      const { lastOk } = await deps.runs.latest();
      // No copy yet: counted from the first check of this process, so a fresh environment is not stale at boot.
      const ref = lastOk?.snapshotAt ?? firstSeen;
      if (!isBackupStale(ref, now)) return { result: 'fresh' };
      const ageMinutes = lastOk ? Math.floor((now - lastOk.snapshotAt) / 60_000) : null;
      deps.alarm.raise({
        level: 'page',
        source: 'ops',
        code: 'backup-stale',
        details: ageMinutes === null ? {} : { ageMinutes },
      });
      deps.log.warn({ event: 'ops/backup-stale', ageMinutes, thresholdMinutes: staleThresholdMs(now) / 60_000 });
      return { result: 'stale', ageMinutes };
    },
    async release() {
      await deps.lease.release('ops-backup').catch(() => undefined);
    },
  };
}
