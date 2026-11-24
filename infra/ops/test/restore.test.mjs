// @ts-check
// SPEC-13b W45 — `ops restore` на фейках: відмови до будь-якого виклику (production, ціль не local, файл джерела,
// проєкт не чистий; AC-54), повна послідовність і звіт (AC-53, AC-57), перевірка копії не пройшла → pg_restore не
// було, тека тимчасових файлів прибрана (AC-55, AC-59), розбіжність рядків → збій, запис заміру (AC-56), вікно втрати.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { lossWindowMs, migrationStatus, PROJECT_PREFIX, projectNameOf, rowCountMismatches, rowCountSql } from '../lib/restore.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const READER = 'a'.repeat(40);
const COMMIT = 'c'.repeat(40);
const NOW = new Date('2026-11-24T12:00:00.000Z');
const KEY = 'rehearsal/backups/db/20261124T110000Z.dump.enc';
const BACKUP_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='; // check-secrets: allow test fake (fixed 32-byte test key)
const R2_SECRET = 'r2-secret-sentinel-0123456789abcdefABCDEF'; // check-secrets: allow fake sentinel (restore test)
const MANIFEST = {
  format: 'T2FB1', key: KEY, size: 4096, sha256: 'e'.repeat(64), keyId: '0a1b2c3d', snapshotAt: '2026-11-24T11:00:00.000Z',
  durationMs: 1200, pgVersion: 17, lastMigration: '20261124_ops', rowCounts: { countries: 3, zones: 40 }, commit: COMMIT,
};
const SNAPSHOTS = ['2026-11-23T09:00:00.000Z', '2026-11-24T09:00:00.000Z', '2026-11-24T10:00:00.000Z', '2026-11-24T11:00:00.000Z'];
const STATUS_TABLE = ['┌──────────────┬───────┬─────┐', '│ Name         │ Batch │ Ran │', '│ 20261123_live │ 1 │ Yes │', '│ 20261124_ops │ 1 │ Yes │', '└──────────────┴───────┴─────┘'].join('\n');
const BASE = ['restore', '--env', 'rehearsal', '--from', 'latest', '--target', 'local'];

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * @param {{
 *   serverEnv?: string | null,
 *   volumes?: string,
 *   pull?: { code: number, stderr?: string } | 'throw',
 *   counts?: string,
 *   manifestCode?: number,
 * }} [o]
 */
function world(o = {}) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-13b-restore-'));
  cleanups.push(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const srcDir = path.join(stateRoot, 'rehearsal');
  fs.mkdirSync(srcDir, { recursive: true });
  const serverEnv =
    o.serverEnv !== undefined
      ? o.serverEnv
      : [
          'T2F_R2_ENDPOINT=https://example.r2.cloudflarestorage.com',
          'T2F_R2_BUCKET=time2fest-rehearsal',
          'T2F_R2_ACCESS_KEY_ID=rehearsal-access-key-id-0123',
          `T2F_R2_SECRET_ACCESS_KEY=${R2_SECRET}`,
          'T2F_R2_PREFIX=rehearsal/',
          `T2F_BACKUP_KEY=${BACKUP_KEY}`,
          '',
        ].join('\n');
  if (serverEnv !== null) fs.writeFileSync(path.join(srcDir, 'server.env'), serverEnv);
  const restoreRoot = path.join(stateRoot, 'restore');
  /** Тека тимчасових файлів існувала під час завантаження. */
  const seen = { tmpDuringPull: false };
  const tmpExists = () => fs.existsSync(restoreRoot) && fs.readdirSync(restoreRoot).some((p) => fs.existsSync(path.join(restoreRoot, p, 'tmp')));
  const fx = createFakeExec([
    { match: ['docker', 'volume', 'ls'], result: { stdout: o.volumes ?? '' } },
    { match: ['docker', 'ps'], result: { stdout: '' } },
    {
      match: (c) => c.argv.includes('--manifest-only'),
      result: { code: o.manifestCode ?? 0, stdout: `[payload] noise\n${JSON.stringify({ ok: true, manifestKey: KEY.replace('.dump.enc', '.manifest.json'), manifest: MANIFEST, snapshots: SNAPSHOTS })}\n` },
    },
    {
      match: (c) => c.argv.includes('restore-pull'),
      result: () => {
        seen.tmpDuringPull = tmpExists();
        if (o.pull === 'throw') throw new Error('docker vanished');
        return o.pull ?? { code: 0, stdout: JSON.stringify({ ok: true, key: KEY }) };
      },
    },
    { match: (c) => c.argv.includes('scripts/health-probe.mjs'), result: { stdout: `200 ${COMMIT}\n` } },
    { match: (c) => c.argv.includes('migrate:status'), result: { stdout: STATUS_TABLE } },
    { match: (c) => c.argv.includes('psql'), result: { stdout: o.counts ?? 'countries,3\nzones,40\n' } },
    { match: (c) => c.argv.includes('status') && c.argv.includes('ops'), result: { stdout: `log line\n${JSON.stringify({ blocks: { catalog: { seasonKey: '2026-27' } } })}\n` } },
  ]);
  /** @type {string[]} */ const built = [];
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  let t = 0;
  const deps = {
    out: (/** @type {string} */ l) => out.push(l),
    err: (/** @type {string} */ l) => err.push(l),
    env: {},
    exec: fx,
    now: () => NOW,
    clock: { now: () => (t += 1000), sleep: async () => {} },
    paths: { stateRoot },
    git: /** @type {any} */ ({ resolveCommit: async () => ({ code: 0, sha: READER }) }),
    image: () => /** @type {any} */ ({ buildImage: async (/** @type {string} */ sha) => (built.push(sha), { code: 0, skipped: true }) }),
    ...FAKE_TARGET,
  };
  const docker = () => fx.calls.filter((c) => c.argv[0] === 'docker');
  const composeCalls = () => docker().filter((c) => c.argv[1] === 'compose');
  return { fx, out, err, deps, built, seen, docker, composeCalls, tmpExists, stateRoot };
}

/** @param {ReturnType<typeof world>} w */
function expectSafe(w) {
  for (const c of w.fx.calls) {
    const a = c.argv.join(' ');
    expect(a).not.toContain(BACKUP_KEY);
    expect(a).not.toContain(R2_SECRET);
    // Локально — лише власний проєкт цього запуску; ніколи `-p t2f` (на вузлі джерела — лише `restore-record`).
    const p = c.argv.indexOf('-p');
    if (c.transport === 'local' && p >= 0) expect(c.argv[p + 1].startsWith(PROJECT_PREFIX)).toBe(true);
  }
  const visible = [...w.out, ...w.err].join('\n');
  expect(visible).not.toContain(BACKUP_KEY);
  expect(visible).not.toContain(R2_SECRET);
  expect(w.tmpExists()).toBe(false);
}

describe('restore refusals before any download (AC-54)', () => {
  it.each([
    [['restore', '--env', 'production', '--from', 'latest', '--target', 'local', '--confirm', 'production']],
    [['restore', '--env', 'production', '--from', 'latest', '--target', 'local']],
    [['restore', '--env', 'rehearsal', '--from', 'latest', '--target', 'production']],
    [['restore', '--env', 'rehearsal', '--from', 'latest', '--target', '203.0.113.5']],
    [['restore', '--env', 'rehearsal', '--from', 'latest', '--target', 'clean']],
    [['restore', '--env', 'rehearsal', '--from', '../etc/passwd', '--target', 'local']],
    [['restore', '--env', 'prelaunch', '--from', 'latest', '--target', 'local', '--confirm', 'prelaunch', '--allow-main-domain']],
    [['restore', '--env', 'rehearsal', '--from', 'latest', '--target', 'local', '--host', '178.20.157.85']],
  ])('%j → code 2, no transport call, no image build', async (argv) => {
    const w = world();
    expect(await main(argv, w.deps)).toBe(2);
    expect(w.fx.calls).toEqual([]);
    expect(w.built).toEqual([]);
  });

  it('missing source variables → code 2 naming them, no call', async () => {
    const w = world({ serverEnv: 'T2F_R2_BUCKET=time2fest-rehearsal\n' });
    expect(await main(BASE, w.deps)).toBe(2);
    expect(w.err.join('\n')).toContain('T2F_BACKUP_KEY');
    expect(w.fx.calls).toEqual([]);
  });

  it('a production-looking bucket → code 2, no call', async () => {
    const w = world({ serverEnv: `T2F_R2_ENDPOINT=https://x\nT2F_R2_BUCKET=time2fest-prod\nT2F_R2_ACCESS_KEY_ID=id-0123456789\nT2F_R2_SECRET_ACCESS_KEY=${R2_SECRET}\nT2F_R2_PREFIX=production/\nT2F_BACKUP_KEY=${BACKUP_KEY}\n` });
    expect(await main(BASE, w.deps)).toBe(2);
    expect(w.fx.calls).toEqual([]);
  });

  it('a volume of the run project already exists → code 2 after the lookups only, nothing downloaded', async () => {
    const w = world({ volumes: 'existing_pgdata\n' });
    expect(await main(BASE, w.deps)).toBe(2);
    expect(w.err.join('\n')).toContain('ціль не чиста');
    expect(w.docker().map((c) => c.argv.slice(0, 3).join(' '))).toEqual(['docker volume ls']);
    expect(w.built).toEqual([]);
    expectSafe(w);
  });
});

describe('restore to a clean local stack (AC-53, AC-56, AC-57, AC-59)', () => {
  it('runs the whole sequence, prints duration and loss window, tears down its own project', async () => {
    const w = world();
    expect(await main(BASE, w.deps), w.err.join('\n')).toBe(0);
    expect(w.built).toEqual([READER, COMMIT]);
    const steps = w.composeCalls().map((c) => c.argv.slice(c.argv.indexOf('-f') + 2).join(' '));
    expect(steps[0]).toBe('up -d --wait postgres redis');
    expect(steps[1]).toMatch(/^--profile pull run --rm --no-deps (-e T2F_\w+ ){6}pull pnpm run ops restore-pull --key rehearsal\/backups\/db\/20261124T110000Z\.dump\.enc$/);
    expect(steps[2]).toBe('up -d --wait server');
    expect(steps.at(-1)).toBe('down -v --remove-orphans');
    expect(w.seen.tmpDuringPull).toBe(true);
    const report = w.out.join('\n');
    expect(report).toContain('вікно втрати 60 хв');
    expect(report).toContain('каталог 2026-27');
    // Без --host замір не пишеться, але команда для ручного запису надрукована (AC-56).
    expect(report).toMatch(/pnpm run ops restore-record --at \S+ --key rehearsal\/backups\/db\/20261124T110000Z\.dump\.enc --duration-ms \d+ --loss-ms 3600000 --result ok --target local/);
    expectSafe(w);
  });

  it('--host records the measurement on the source node through ssh', async () => {
    const w = world();
    expect(await main([...BASE, '--host', 'rehearsal-node.example'], w.deps), w.err.join('\n')).toBe(0);
    const remote = w.fx.calls.filter((c) => c.transport !== 'local');
    expect(remote.map((c) => c.argv.includes('restore-record'))).toEqual([true]);
    const rec = remote[0];
    expect(rec?.transport).toBe('ssh:rehearsal-node.example');
    expect(rec?.argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 't2f-rehearsal']);
    expect(rec?.argv).toEqual(expect.arrayContaining(['--result', 'ok', '--target', 'local', '--loss-ms', '3600000']));
    expectSafe(w);
  });

  it('--no-record writes nothing to the source; --keep leaves the stack up', async () => {
    const w = world();
    expect(await main([...BASE, '--no-record', '--keep'], w.deps)).toBe(0);
    expect(w.fx.calls.some((c) => c.argv.includes('restore-record'))).toBe(false);
    expect(w.composeCalls().some((c) => c.argv.includes('down'))).toBe(false);
    expect(w.out.join('\n')).not.toContain('restore-record');
    expectSafe(w);
  });

  it('copy verification failed (exit 3) → code 1, server never started, temp dir removed, stack down (AC-55)', async () => {
    const w = world({ pull: { code: 3, stderr: 'ops: restore-pull verify failed (sha256)' } });
    expect(await main([...BASE, '--no-record'], w.deps)).toBe(1);
    expect(w.err.join('\n')).toContain('перевірка копії не пройшла');
    expect(w.composeCalls().some((c) => c.argv.includes('server') && c.argv.includes('up'))).toBe(false);
    expect(w.composeCalls().at(-1)?.argv).toContain('down');
    expectSafe(w);
  });

  it('a thrown step → code 1, temp dir removed, stack down', async () => {
    const w = world({ pull: 'throw' });
    expect(await main([...BASE, '--no-record'], w.deps)).toBe(1);
    expect(w.seen.tmpDuringPull).toBe(true);
    expect(w.composeCalls().at(-1)?.argv).toContain('down');
    expectSafe(w);
  });

  it('row counts differ from the manifest → code 1 naming the table; the failure is recorded', async () => {
    const w = world({ counts: 'countries,3\nzones,39\n' });
    expect(await main(BASE, w.deps)).toBe(1);
    expect(w.err.join('\n')).toContain('zones: маніфест 40, ціль 39');
    expect(w.out.join('\n')).toContain('--result failed');
    expectSafe(w);
  });

  it('the manifest cannot be read → nothing started, no stack', async () => {
    const w = world({ manifestCode: 2 });
    expect(await main(BASE, w.deps)).toBe(2);
    expect(w.composeCalls()).toEqual([]);
    expectSafe(w);
  });
});

describe('restore helpers', () => {
  it('loss window = largest gap of neighbouring snapshots in the 24 h before the copy; one copy → null', () => {
    expect(lossWindowMs(SNAPSHOTS, Date.parse('2026-11-24T11:00:00.000Z'))).toBe(3_600_000);
    expect(lossWindowMs(['2026-11-24T11:00:00.000Z'], Date.parse('2026-11-24T11:00:00.000Z'))).toBeNull();
    expect(lossWindowMs(['2026-11-24T08:00:00.000Z', '2026-11-24T08:30:00.000Z', '2026-11-24T11:00:00.000Z'], Date.parse('2026-11-24T11:00:00.000Z'))).toBe(9_000_000);
  });

  it('migration status table → pending and applied names', () => {
    expect(migrationStatus(STATUS_TABLE)).toEqual({ pending: [], applied: ['20261123_live', '20261124_ops'] });
    expect(migrationStatus('| a | 1 | Yes |\n| b |  | No |').pending).toEqual(['b']);
  });

  it('row count SQL refuses a non-table name; mismatches list missing tables', () => {
    expect(rowCountSql({ zones: 1, countries: 2 })).toBe(`SELECT 'countries', count(*) FROM "countries" UNION ALL SELECT 'zones', count(*) FROM "zones"`);
    expect(() => rowCountSql({ 'x"; DROP TABLE y; --': 1 })).toThrow();
    expect(rowCountMismatches('zones,1\n', { zones: 1, countries: 2 })).toEqual(['countries: маніфест 2, ціль —']);
  });

  it('the project name is the restore prefix + UTC stamp', () => {
    expect(projectNameOf(NOW)).toBe('t2f-restore-20261124t120000z');
  });
});
