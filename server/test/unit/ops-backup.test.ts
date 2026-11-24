/**
 * SPEC-13b W26: the backup job without Postgres or R2 — a fake `pg_dump` runner and an in-memory object store.
 * AC-42 versions 16/17 → `stage:'version'`, 17/17 → copy; AC-48 class matrix (no key → one
 * `backup-not-configured` per process in rehearsal, none in test; test + non-loopback R2 → refused; rehearsal with
 * the production bucket → the existing env refusal); AC-44 stages (dump, upload, manifest) with no manifest left;
 * AC-45 stale bounds 26 h / 2 h exact; AC-46 retention 40 daily + 100 hourly + a foreign object → 10 + 28 pairs;
 * AC-57 loss window.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ObjectListing, ObjectStore } from '../../src/catalog/ports';
import { lossWindow } from '../../src/domain/ops/lossWindow';
import { backupPairs, backupStamp, retentionPlan } from '../../src/domain/ops/retention';
import { isBackupStale } from '../../src/domain/ops/schedule';
import { createBackupJob, runBackup, type BackupDeps, type BackupJobDeps } from '../../src/ops/backup';
import { BACKUP_MAGIC, keyIdOf } from '../../src/ops/backupFormat';
import type { BackupRun, BackupRunStore, DumpRunner, OpsLease } from '../../src/ops/ports';
import { runRetention } from '../../src/ops/retention';
import type { EnvClass } from '../../src/platform/env';
import { loadEnv } from '../../src/platform/env';
import type { AlarmInput } from '../../src/ports';
import { envRegistry } from '../../src/registries/env';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEY = Buffer.alloc(32, 7);
const PREFIX = 't2f/unit/';
const BACKUPS = `${PREFIX}backups/db/`;
const NOW = Date.UTC(2026, 10, 24, 3, 0, 5);
const silent = { info: () => {}, warn: () => {}, error: () => {} };

function fakeDump(client = 17, server = 17, body: Buffer | Error = Buffer.from('PGDMP-fake-dump-'.repeat(1000))): DumpRunner {
  return {
    version: async () => client,
    serverVersion: async () => server,
    dump: () => {
      if (body instanceof Error) {
        const r = new Readable({ read() {} });
        r.push(Buffer.from('PGDMP-partial'));
        setTimeout(() => r.destroy(body), 5);
        return r;
      }
      return Readable.from([body.subarray(0, 100), body.subarray(100)]);
    },
  };
}

interface MemStore extends ObjectStore {
  objects: Map<string, Buffer>;
  aborted: number;
}

function memStore(fail: { upload?: boolean; manifest?: boolean } = {}): MemStore {
  const objects = new Map<string, Buffer>();
  const store: MemStore = {
    objects,
    aborted: 0,
    async put(key, body) {
      if (fail.manifest && key.endsWith('.manifest.json')) throw new Error('down');
      objects.set(key, Buffer.from(body));
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key): ObjectListing => ({ key, size: objects.get(key)!.length, lastModified: 0 }));
    },
    async putMultipart(key, body) {
      const parts: Buffer[] = [];
      try {
        for await (const c of body as AsyncIterable<Buffer>) {
          if (fail.upload) throw new Error('r2 down');
          parts.push(c);
        }
      } catch (err) {
        store.aborted += 1;
        body.destroy();
        throw err;
      }
      const all = Buffer.concat(parts);
      objects.set(key, all);
      return { size: all.length };
    },
  };
  return store;
}

function memRuns(): BackupRunStore & { rows: BackupRun[] } {
  const rows: BackupRun[] = [];
  return {
    rows,
    async record(run) {
      rows.push(run);
    },
    async latest() {
      const by = [...rows].sort((a, b) => b.snapshotAt - a.snapshotAt);
      return { last: by[0] ?? null, lastOk: by.find((r) => r.result === 'ok') ?? null };
    },
    async okSince(since) {
      return rows.filter((r) => r.result === 'ok' && r.snapshotAt >= since);
    },
    async scheduledSince(since) {
      return rows.some((r) => r.kind !== 'manual' && r.snapshotAt >= since);
    },
  };
}

function setup(over: { cls?: EnvClass; key?: Buffer | null; endpoint?: string; dump?: DumpRunner; store?: MemStore } = {}) {
  const alarms: AlarmInput[] = [];
  const lines: { action: string; target: string; after: Record<string, unknown> }[] = [];
  const store = over.store ?? memStore();
  const runs = memRuns();
  const key = over.key === undefined ? KEY : over.key;
  const deps: BackupDeps = {
    config: {
      key,
      keyId: key ? keyIdOf(key) : null,
      store,
      prefix: PREFIX,
      endpoint: over.endpoint ?? 'http://127.0.0.1:9090',
      dump: over.dump ?? fakeDump(),
      commit: 'a'.repeat(40),
    },
    cls: over.cls ?? 'test',
    alarm: { raise: (a) => alarms.push(a) },
    log: silent,
    journal: { line: async (action, target, after) => void lines.push({ action, target, after }) },
    runs,
    facts: { lastMigration: async () => '20261124_011346_ops', rowCounts: async () => ({ countries: 3, zones: 2 }) },
    clock: { now: () => NOW },
  };
  return { deps, alarms, lines, store, runs };
}

const freeLease: OpsLease = { acquire: async () => true, release: async () => {} };

describe('backup run (W24)', () => {
  it('AC-41/AC-43: 17/17 → T2FB1 object, then a manifest with exact size and sha256, a backup-runs row', async () => {
    const { deps, store, runs, alarms } = setup();
    const out = await runBackup(deps, NOW, 'daily');
    expect(out.result).toBe('ok');
    const stamp = backupStamp(NOW);
    expect(stamp).toBe('20261124T030005Z');
    const dump = store.objects.get(`${BACKUPS}${stamp}.dump.enc`)!;
    expect(dump.subarray(0, 5).toString('ascii')).toBe(BACKUP_MAGIC);
    expect(dump.includes(Buffer.from('PGDMP'))).toBe(false);
    const manifest = JSON.parse(store.objects.get(`${BACKUPS}${stamp}.manifest.json`)!.toString('utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: 'T2FB1',
      size: dump.length,
      sha256: createHash('sha256').update(dump).digest('hex'),
      keyId: keyIdOf(KEY),
      snapshotAt: new Date(NOW).toISOString(),
      pgVersion: 17,
      lastMigration: '20261124_011346_ops',
      rowCounts: { countries: 3, zones: 2 },
      commit: 'a'.repeat(40),
    });
    expect(JSON.stringify(manifest)).not.toContain(KEY.toString('base64'));
    expect(runs.rows).toEqual([expect.objectContaining({ result: 'ok', kind: 'daily', size: dump.length, snapshotAt: NOW })]);
    expect(alarms).toEqual([]);
  });

  it('AC-42: pg_dump 16 against server 17 → page stage version, nothing uploaded', async () => {
    const { deps, store, alarms, runs, lines } = setup({ dump: fakeDump(16, 17) });
    const out = await runBackup(deps, NOW, 'daily');
    expect(out).toMatchObject({ result: 'failed', stage: 'version' });
    expect(alarms).toEqual([{ level: 'page', source: 'ops', code: 'backup-failed', details: { stage: 'version' } }]);
    expect(store.objects.size).toBe(0);
    expect(runs.rows[0]).toMatchObject({ result: 'failed', stage: 'version' });
    expect(lines[0]).toMatchObject({ action: 'ops.backup-failed', after: { stage: 'version' } });
  });

  it('AC-44: a dump that dies mid-stream → stage dump, upload aborted, no manifest', async () => {
    const store = memStore();
    const { deps, alarms } = setup({ dump: fakeDump(17, 17, new Error('pg_dump: exited with 1')), store });
    const out = await runBackup(deps, NOW, 'hourly');
    expect(out).toMatchObject({ result: 'failed', stage: 'dump' });
    expect(store.aborted).toBe(1);
    expect([...store.objects.keys()]).toEqual([]);
    expect(alarms[0]?.details).toEqual({ stage: 'dump' });
  });

  it('AC-44: R2 failing during the upload → stage upload, no manifest', async () => {
    const store = memStore({ upload: true });
    const { deps, alarms } = setup({ store });
    expect(await runBackup(deps, NOW, 'daily')).toMatchObject({ result: 'failed', stage: 'upload' });
    expect(store.objects.size).toBe(0);
    expect(alarms[0]?.details).toEqual({ stage: 'upload' });
  });

  it('AC-44: the manifest write failing → stage manifest, the dump object removed', async () => {
    const store = memStore({ manifest: true });
    const { deps } = setup({ store });
    expect(await runBackup(deps, NOW, 'daily')).toMatchObject({ result: 'failed', stage: 'manifest' });
    expect(store.objects.size).toBe(0);
  });
});

describe('backup class matrix (AC-48)', () => {
  it('rehearsal without a key → off, one backup-not-configured per process', async () => {
    const { deps, alarms } = setup({ cls: 'rehearsal', key: null });
    const job = createBackupJob({ ...deps, lease: freeLease } satisfies BackupJobDeps);
    expect(await job.scheduled(NOW)).toEqual({ result: 'off', reason: 'not-configured' });
    expect(await job.scheduled(NOW + HOUR)).toEqual({ result: 'off', reason: 'not-configured' });
    expect(alarms).toEqual([{ level: 'page', source: 'ops', code: 'backup-not-configured' }]);
  });

  it('test without a key → off, no alarm', async () => {
    const { deps, alarms } = setup({ cls: 'test', key: null });
    expect(await createBackupJob({ ...deps, lease: freeLease }).scheduled(NOW)).toEqual({ result: 'off', reason: 'not-configured' });
    expect(alarms).toEqual([]);
  });

  it('test with a non-loopback R2 endpoint → refused, nothing written', async () => {
    const { deps, store } = setup({ cls: 'test', endpoint: 'https://account.r2.cloudflarestorage.com' });
    expect(await runBackup(deps, NOW, 'daily')).toEqual({ result: 'refused', reason: 'non-loopback' });
    expect(store.objects.size).toBe(0);
  });

  it('the production bucket outside production → the existing env refusal before anything starts', () => {
    const result = loadEnv(
      {
        T2F_ENV: 'test',
        DATABASE_URI: 'postgres://t2f:pw@localhost:5433/t2f_unit_test', // check-secrets: allow fake local DATABASE_URI for the env loader unit test
        REDIS_URL: 'redis://localhost:6380/26',
        T2F_REDIS_PREFIX: 't2f:unit:',
        T2F_R2_BUCKET: 'time2fest-prod',
      },
      envRegistry,
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { failing: string[] }).failing).toContain('T2F_R2_BUCKET');
  });
});

describe('backup schedule job (AC-40)', () => {
  it('one copy per slot: a second tick in the same slot is idle; a held lease skips', async () => {
    const { deps, store } = setup();
    const job = createBackupJob({ ...deps, lease: freeLease });
    expect((await job.scheduled(NOW)).result).toBe('ok');
    expect((await job.scheduled(NOW + 60_000)).result).toBe('idle');
    // Another process sees the row of the slot.
    const other = createBackupJob({ ...deps, lease: freeLease });
    expect((await other.scheduled(NOW + 120_000)).result).toBe('idle');
    expect([...store.objects.keys()].filter((k) => k.endsWith('.dump.enc'))).toHaveLength(1);
    const held = createBackupJob({ ...setup().deps, lease: { acquire: async () => false, release: async () => {} } });
    expect(await held.scheduled(NOW)).toEqual({ result: 'held-elsewhere' });
  });
});

describe('stale check (AC-45)', () => {
  it('bounds are exact: 26 h outside the window, 2 h inside', () => {
    const outside = Date.UTC(2026, 10, 24, 12);
    expect(isBackupStale(outside - 26 * HOUR, outside)).toBe(false);
    expect(isBackupStale(outside - 26 * HOUR - 1, outside)).toBe(true);
    const inside = Date.UTC(2026, 11, 31, 12);
    expect(isBackupStale(inside - 2 * HOUR, inside)).toBe(false);
    expect(isBackupStale(inside - 2 * HOUR - 1, inside)).toBe(true);
  });

  it('pages backup-stale with the age, at most once per 10 min per process', async () => {
    const { deps, alarms, runs } = setup();
    const at = Date.UTC(2026, 10, 24, 12);
    runs.rows.push({ key: 'k', kind: 'daily', result: 'ok', durationMs: 1, snapshotAt: at - 27 * HOUR });
    const job = createBackupJob({ ...deps, lease: freeLease });
    expect(await job.staleCheck(at)).toEqual({ result: 'stale', ageMinutes: 27 * 60 });
    expect(await job.staleCheck(at + 60_000)).toEqual({ result: 'idle' });
    expect(alarms).toEqual([{ level: 'page', source: 'ops', code: 'backup-stale', details: { ageMinutes: 27 * 60 } }]);
    runs.rows.push({ key: 'k2', kind: 'daily', result: 'ok', durationMs: 1, snapshotAt: at });
    expect(await job.staleCheck(at + 600_000)).toEqual({ result: 'fresh' });
  });
});

describe('retention (AC-46)', () => {
  const keysOf = (at: number) => [`${BACKUPS}${backupStamp(at)}.dump.enc`, `${BACKUPS}${backupStamp(at)}.manifest.json`];
  const now = Date.UTC(2027, 0, 20, 12);
  // 40 daily at 03:00:10 UTC and 100 hourly at :00:20 (never 03 h), all before `now`.
  const daily = Array.from({ length: 40 }, (_, i) => Date.UTC(2027, 0, 19, 3, 0, 10) - i * DAY);
  const hourly: number[] = [];
  for (let t = Date.UTC(2027, 0, 20, 11, 0, 20); hourly.length < 100; t -= HOUR) if (new Date(t).getUTCHours() !== 3) hourly.push(t);
  const all = [...daily.flatMap(keysOf), ...hourly.flatMap(keysOf), 'catalog/x.json', `${PREFIX}catalog/x.json`, `${BACKUPS}notes.txt`];

  it('40 daily + 100 hourly + foreign objects → 10 + 28 pairs, foreign and newest kept', () => {
    expect(backupPairs(all, BACKUPS)).toHaveLength(140);
    const doomed = retentionPlan(all, BACKUPS, now);
    expect(doomed.filter((p) => p.kind === 'daily')).toHaveLength(10);
    expect(doomed.filter((p) => p.kind === 'hourly')).toHaveLength(28);
    const dropped = new Set(doomed.flatMap((p) => [p.dumpKey, p.manifestKey]));
    for (const k of daily.slice(0, 30).flatMap(keysOf)) expect(dropped.has(k)).toBe(false);
    for (const k of daily.slice(30).flatMap(keysOf)) expect(dropped.has(k)).toBe(true);
    for (const k of hourly.slice(0, 72).flatMap(keysOf)) expect(dropped.has(k)).toBe(false);
    for (const k of ['catalog/x.json', `${PREFIX}catalog/x.json`, `${BACKUPS}notes.txt`]) expect(dropped.has(k)).toBe(false);
  });

  it('a dump without a manifest is never a pair; the newest pair survives even past the limits', () => {
    const orphan = `${BACKUPS}${backupStamp(now - HOUR)}.dump.enc`;
    expect(retentionPlan([orphan], BACKUPS, now)).toEqual([]);
    expect(retentionPlan(keysOf(now - 400 * DAY), BACKUPS, now)).toEqual([]);
    // A similar name under another prefix is not ours.
    expect(backupPairs(keysOf(now - HOUR).map((k) => k.replace(BACKUPS, 'other/backups/db/')), BACKUPS)).toEqual([]);
  });

  it('the executor deletes only the planned pairs, one journal line each', async () => {
    const store = memStore();
    for (const k of all) store.objects.set(k, Buffer.from('x'));
    const lines: string[] = [];
    const out = await runRetention({ store, backupsPrefix: BACKUPS, journal: { line: async (a, t) => void lines.push(`${a} ${t}`) } }, now);
    expect(out).toEqual({ deleted: 38 });
    expect(lines).toHaveLength(38);
    expect(lines.every((l) => l.startsWith(`ops.backup-deleted ${BACKUPS}`))).toBe(true);
    expect(store.objects.size).toBe(all.length - 76);
    expect(store.objects.has('catalog/x.json')).toBe(true);
    expect(store.objects.has(`${PREFIX}catalog/x.json`)).toBe(true);
  });
});

describe('loss window (AC-57)', () => {
  it('the largest gap between neighbouring successful snapshots within 24 h', () => {
    const now = Date.UTC(2026, 11, 31, 12);
    const at = (h: number) => ({ snapshotAt: now - h * HOUR });
    expect(lossWindow([at(30), at(20), at(19), at(15), at(14), at(1)], now)).toBe(13 * HOUR);
    expect(lossWindow([at(1)], now)).toBeNull();
    expect(lossWindow([at(25), at(1)], now)).toBeNull();
  });
});
