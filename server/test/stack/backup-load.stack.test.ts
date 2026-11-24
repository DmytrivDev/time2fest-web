/**
 * SPEC-13b W46 — копія під навантаженням (AC-47, NFR-2, NFR-3). HEAVY: лише під винятковим замком машини
 * (`node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.stack.config.ts --maxWorkers=1
 * test/stack/backup-load.stack.test.ts`).
 *
 * - Тестова база worktree (`<slug>_test`, уже засіяна) розмножується до 10× рядків ключових таблиць каталогу
 *   (копії з позначкою `~x<n>` в унікальному полі; прибираються в кінці).
 * - Сервер — контейнер з образу (`T2F_LOAD_IMAGE`, типово `t2f-server:13bcheck`) класу `test` на цій базі; він
 *   слухає лише 127.0.0.1 контейнера, тож для опитування з хоста той самий переходник, що в наборі ops, відкриває
 *   його на випадковому порту 127.0.0.1 хоста. Контейнер — `t2f-restore-load-<pid>` (не проєкт `t2f`).
 * - Копія — справжній `runBackup` у процесі тесту (стрім → шифрування → multipart у s3mock, префікс
 *   `<prefix>backup-load/`), `pg_dump` — з образу (`nice -n 10 pg_dump`), як на вузлі. Приріст RSS процесу —
 *   те, що копія додає процесу сервера (NFR-3); `pg_dump` і на вузлі окремий процес.
 * - `/api/health` опитується щосекунди до й під час копії: жодного 503, p95 під час ≤2× звичайного.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3Client, createS3ObjectStore } from '../../src/adapters/s3';
import { PG_DUMP_ARGS, parsePgDumpVersion, pgEnvOf, runForOutput, streamOf } from '../../src/adapters/pgDump';
import { runBackup, type BackupDeps } from '../../src/ops/backup';
import { keyIdOf, parseBackupKey } from '../../src/ops/backupFormat';
import type { DumpRunner } from '../../src/ops/ports';
import { envLocal, wt } from './env';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const IMAGE = process.env.T2F_LOAD_IMAGE ?? 't2f-server:13bcheck';
const CONTAINER = `t2f-restore-load-${process.pid}`;
const MULTIPLY = 10;
/** Таблиці каталогу, що розмножуються, і їхнє унікальне поле. */
const MULTIPLIED: ReadonlyArray<readonly [string, string]> = [
  ['cities', 'city_id'],
  ['events', 'event_id'],
  ['traditions', 'tradition_id'],
  ['stream_sources', 'source_id'],
];
/** Ті самі ключові таблиці, що й маніфест (BACKUP_COUNTED). */
const COUNTED = ['admins', 'cities', 'countries', 'events', 'seasons', 'traditions', 'zones'];
const MARK = '~x';
const MB = 1024 * 1024;
const FORWARDER_JS =
  "const n=require('net');const [lp,h,p,la]=process.argv.slice(1);n.createServer((c)=>{const u=n.connect(+p,h);c.pipe(u).pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy())}).listen(+lp,la||'127.0.0.1')";

const testUri = (() => {
  const u = new URL(String(envLocal.DATABASE_URI));
  u.pathname = `/${wt.testDatabase}`;
  return u.toString();
})();
const r2 = {
  endpoint: String(envLocal.T2F_R2_ENDPOINT),
  bucket: String(envLocal.T2F_R2_BUCKET),
  accessKeyId: String(envLocal.T2F_R2_ACCESS_KEY_ID),
  secretAccessKey: String(envLocal.T2F_R2_SECRET_ACCESS_KEY),
  prefix: `${String(envLocal.T2F_R2_PREFIX)}backup-load/`,
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-backup-load-'));
let db: pg.Client;
let port = 0;
const numbers: Record<string, number | string> = {};

const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', timeout, windowsHide: true });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? Number.NaN;
};

async function healthOnce(): Promise<{ status: number; ms: number }> {
  const t0 = performance.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10_000) });
    await r.arrayBuffer();
    return { status: r.status, ms: performance.now() - t0 };
  } catch {
    return { status: 0, ms: performance.now() - t0 };
  }
}

/** Опитування щосекунди, доки `until()` не скаже «досить». */
async function pollHealth(until: () => boolean): Promise<Array<{ status: number; ms: number }>> {
  const out: Array<{ status: number; ms: number }> = [];
  while (!until()) {
    const tick = Date.now();
    out.push(await healthOnce());
    await new Promise((r) => setTimeout(r, Math.max(0, 1_000 - (Date.now() - tick))));
  }
  return out;
}

/** `pg_dump` з образу: `docker run … nice -n 10 pg_dump`; пароль — лише в середовищі дитини (`-e NAME`). */
function imageDumpRunner(): DumpRunner {
  const env = { ...pgEnvOf(testUri), PGHOST: 'host.docker.internal' };
  const pass = Object.keys(env).flatMap((k) => ['-e', k]);
  return {
    async version() {
      return parsePgDumpVersion(await runForOutput({ cmd: 'docker', args: ['run', '--rm', '--entrypoint', 'pg_dump', IMAGE, '--version'], env: {} }, 120_000));
    },
    async serverVersion() {
      const { rows } = await db.query<{ v: string }>(`SELECT current_setting('server_version_num') AS v`);
      return Math.floor(Number(rows[0]?.v) / 10_000);
    },
    dump: () => streamOf({ cmd: 'docker', args: ['run', '--rm', ...pass, '--entrypoint', 'nice', IMAGE, '-n', '10', 'pg_dump', ...PG_DUMP_ARGS], env }),
  };
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED) {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`);
    out[t] = Number(rows[0]?.n);
  }
  return out;
}

async function multiply(): Promise<void> {
  for (const [table, unique] of MULTIPLIED) {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name <> 'id' ORDER BY ordinal_position`,
      [table],
    );
    const cols = rows.map((r) => `"${r.column_name}"`);
    const select = cols.map((c) => (c === `"${unique}"` ? `${c} || '${MARK}' || g` : c));
    await db.query(
      `INSERT INTO "${table}" (${cols.join(', ')}) SELECT ${select.join(', ')} FROM "${table}", generate_series(1, ${MULTIPLY - 1}) AS g WHERE "${unique}" NOT LIKE '%${MARK}%'`,
    );
  }
}

async function unmultiply(): Promise<void> {
  for (const [table, unique] of MULTIPLIED) await db.query(`DELETE FROM "${table}" WHERE "${unique}" LIKE '%${MARK}%'`);
}

async function clearCopies(): Promise<void> {
  const client = createS3Client(r2);
  const page = await client.send(new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: r2.prefix }));
  const keys = (page.Contents ?? []).map((o) => ({ Key: String(o.Key) }));
  if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket: r2.bucket, Delete: { Objects: keys } }));
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: testUri });
  await db.connect();
  await unmultiply();
  const before = await counts();
  expect(before.countries, 'тестова база не засіяна').toBeGreaterThan(0);
  const size0 = (await db.query<{ s: string }>('SELECT pg_database_size(current_database())::text AS s')).rows[0]?.s;
  await multiply();
  const size1 = (await db.query<{ s: string }>('SELECT pg_database_size(current_database())::text AS s')).rows[0]?.s;
  numbers.dbBytesSeed = Number(size0);
  numbers.dbBytes10x = Number(size1);
  numbers.rows10x = JSON.stringify(await counts());

  port = await freePort();
  const envFile = path.join(tmp, 'server.env');
  // Клас `test` приймає лише loopback-базу й Redis: URL — як у `.env.local`, переходники в контейнері ведуть
  // 127.0.0.1:<порт> до тих самих портів хоста.
  const pgPort = new URL(testUri).port || '5433';
  const redisPort = new URL(String(envLocal.REDIS_URL)).port || '6380';
  const vars: Record<string, string> = {
    T2F_ENV: 'test',
    DATABASE_URI: testUri,
    REDIS_URL: String(envLocal.REDIS_URL),
    T2F_REDIS_PREFIX: String(envLocal.T2F_REDIS_PREFIX),
    PAYLOAD_SECRET: crypto.randomBytes(32).toString('base64url'),
    T2F_HOST: '0.0.0.0',
    T2F_SERVER_PORT: '3000',
    T2F_FWD: FORWARDER_JS,
  };
  fs.writeFileSync(envFile, `${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  docker(['rm', '-f', CONTAINER]);
  const run = docker([
    'run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${port}:3001`, '--env-file', envFile, '--entrypoint', 'sh', IMAGE, '-c',
    `${[pgPort, redisPort].map((p) => `node -e "$T2F_FWD" ${p} host.docker.internal ${p} 127.0.0.1 & `).join('')}node -e "$T2F_FWD" 3001 127.0.0.1 3000 0.0.0.0 & exec node scripts/image-start.mjs`,
  ]);
  fs.rmSync(envFile, { force: true });
  expect(run.status, run.stderr).toBe(0);
  const until = Date.now() + 240_000;
  let last = { status: 0, ms: 0 };
  while (Date.now() < until) {
    last = await healthOnce();
    if (last.status === 200) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  if (last.status !== 200) console.log(docker(['logs', '--tail', '30', CONTAINER]).stdout);
  expect(last.status, 'сервер не став здоровим').toBe(200);
  await clearCopies();
}, 600_000);

afterAll(async () => {
  console.log(`[w46-load] numbers ${JSON.stringify(numbers)}`);
  docker(['rm', '-f', CONTAINER]);
  await clearCopies().catch(() => undefined);
  if (db) {
    await unmultiply().catch(() => undefined);
    await db.end();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}, 120_000);

describe('копія на базі 10× під опитуванням /api/health (W46)', () => {
  it('без 503, p95 ≤2×, приріст RSS ≤100 МБ, ≤5 хв (AC-47, NFR-2, NFR-3)', async () => {
    // Звичайний p95: 15 опитувань щосекунди (перші запити прогрівають маршрут).
    for (let i = 0; i < 3; i += 1) await healthOnce();
    let n = 0;
    const baseline = await pollHealth(() => n++ >= 15);

    const key = crypto.randomBytes(32);
    const deps: BackupDeps = {
      config: {
        key: parseBackupKey(key.toString('base64')),
        keyId: keyIdOf(key),
        store: createS3ObjectStore(r2),
        prefix: r2.prefix,
        endpoint: r2.endpoint,
        dump: imageDumpRunner(),
        commit: null,
      },
      cls: 'test',
      alarm: { raise: () => undefined },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      journal: { line: async () => undefined },
      runs: { record: async () => undefined, latest: async () => ({ last: null, lastOk: null }), okSince: async () => [], scheduledSince: async () => false },
      facts: {
        lastMigration: async () => (await db.query<{ name: string }>('SELECT name FROM payload_migrations ORDER BY id DESC LIMIT 1')).rows[0]?.name ?? null,
        rowCounts: counts,
      },
      clock: { now: Date.now },
    };

    global.gc?.();
    const rss0 = process.memoryUsage().rss;
    let rssMax = rss0;
    const sampler = setInterval(() => {
      rssMax = Math.max(rssMax, process.memoryUsage().rss);
    }, 50);
    let done = false;
    const t0 = Date.now();
    const during = pollHealth(() => done);
    const out = await runBackup(deps, Date.now(), 'manual').finally(() => {
      done = true;
    });
    const ms = Date.now() - t0;
    clearInterval(sampler);
    const samples = await during;

    expect(out.result, JSON.stringify(out)).toBe('ok');
    const size = out.result === 'ok' ? out.manifest.size : 0;
    const base95 = p95(baseline.map((s) => s.ms));
    const during95 = p95(samples.map((s) => s.ms));
    Object.assign(numbers, {
      backupMs: ms,
      dumpBytes: size,
      rssDeltaMB: Math.round(((rssMax - rss0) / MB) * 10) / 10,
      healthBaselineP95Ms: Math.round(base95 * 10) / 10,
      healthDuringP95Ms: Math.round(during95 * 10) / 10,
      healthSamplesDuring: samples.length,
      healthStatusesDuring: [...new Set(samples.map((s) => s.status))].join(','),
      healthStatusesBaseline: [...new Set(baseline.map((s) => s.status))].join(','),
    });
    console.log(`[w46-load] ${JSON.stringify(numbers)}`);

    expect(baseline.every((s) => s.status === 200)).toBe(true);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.filter((s) => s.status !== 200)).toEqual([]);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
    expect(during95).toBeLessThanOrEqual(2 * base95);
    expect(rssMax - rss0).toBeLessThanOrEqual(100 * MB);
  }, 600_000);
});
