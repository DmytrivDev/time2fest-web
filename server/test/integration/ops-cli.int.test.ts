/**
 * SPEC-13b W37: the server command `ops` against the worktree's test database and the s3mock emulator.
 * - AC-38 `ops status` (a real process) prints the overview JSON that passes `OverviewSchema` and writes nothing.
 * - AC-52 `backup-now` makes a `manual` copy (dump + manifest objects) and prints the key and the manifest.
 * - AC-56 `restore-record` (a real process) → a `restore-runs` row and a journal line; the overview shows it.
 * - AC-63 `spend-record server` (a real process) → the `server` row moves and a journal line is written.
 * - AC-53/55/59 `restore-pull` into the throw-away database `<test db>_restore` (created and dropped here):
 *   a flipped byte → exit 3 `sha256`, another key → exit 3 `key-id`, a non-empty target and the production class
 *   are refused, the temp root is empty after every run, and a good copy restores with the manifest's row counts.
 * `backup-now` and `restore-pull` run in-process with the `pg_dump` / `pg_restore` 17 of this machine or the
 * stack's container (`test/support/pgDumpRunner.ts`); the other commands run as `tsx src/cli/ops.ts`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sql } from '@payloadcms/db-postgres';
import pg from 'pg';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overviewSourcesOf } from '../../src/adapters/overviewSources';
import { createPayloadBackupFacts } from '../../src/adapters/payloadOps';
import { createS3ObjectStore } from '../../src/adapters/s3';
import { opsPortsOf, restorePortsOf, runOps, RESTORE_RECORD_ACTION, SPEND_RECORD_ACTION, type OpsCliDeps } from '../../src/cli/ops';
import { payloadOf } from '../../src/container';
import { monthPeriod } from '../../src/domain/ops/spend';
import type { Deps } from '../../src/endpoints/types';
import type { ObjectStore } from '../../src/catalog/ports';
import { buildOverview } from '../../src/ops/overview';
import { OverviewSchema } from '../../src/ops/overviewSchema';
import type { RestoreRunner } from '../../src/ops/restorePull';
import { testDumpRunner, testRestoreRunner } from '../support/pgDumpRunner';
import { testDeps } from './helpers';
import { deleteUnder, listKeys, r2Env, type R2Env } from './r2-helpers';

const TEST_BACKUP_KEY = 'dGVzdC1iYWNrdXAta2V5LW5vdC1yZWFsLTMyYnl0ZXM='; // check-secrets: allow test fake backup key
const OTHER_BACKUP_KEY = 'b3RoZXItYmFja3VwLWtleS1ub3QtcmVhbC0zMmJ5dGU='; // check-secrets: allow test fake backup key
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const RESTORE_DB = /^t2f_[a-z0-9_]+_restore$/;

function cli(args: string[]) {
  const out = spawnSync(process.execPath, [tsx, 'src/cli/ops.ts', ...args], {
    cwd: serverDir,
    env: { ...process.env, T2F_ENV: 'test' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  // Library warnings may precede the answer on stdout; the answer is the last line.
  const last = out.stdout.trim().split('\n').at(-1) ?? '';
  return { status: out.status, last, stderr: out.stderr.trim() };
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

/** A store whose dump objects come back with one byte flipped (the tampered download of AC-55). */
function flipping(inner: ObjectStore): ObjectStore {
  return {
    ...inner,
    async get(key) {
      const body = await inner.get!(key);
      if (body === null || !key.endsWith('.dump.enc')) return body;
      let seen = 0;
      const flip = new Transform({
        transform(chunk: Buffer, _e, cb) {
          const c = Buffer.from(chunk);
          if (seen <= 100 && seen + c.length > 100) c[100 - seen]! ^= 0xff;
          seen += c.length;
          cb(null, c);
        },
      });
      return (body as Readable).pipe(flip);
    },
  };
}

describe('server command ops (W37)', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let r2: R2Env;
  let backups: string;
  let tmpRoot: string;
  let adminUri: string;
  let restoreDb: string;
  let restoreUri: string;
  let runner: RestoreRunner;
  let backupKey: string;
  let manifest: { rowCounts: Record<string, number>; key: string };

  const db = () => (payload.db as unknown as { drizzle: { execute(q: unknown): Promise<{ rows: Record<string, unknown>[] }> } }).drizzle;
  const count = async (table: string) => {
    const { rows } = await db().execute(sql`SELECT count(*)::int AS "n" FROM ${sql.identifier(table)}`);
    return Number(rows[0]?.n);
  };
  const admin = async (fn: (c: pg.Client) => Promise<void>) => {
    const c = new pg.Client({ connectionString: adminUri });
    await c.connect();
    try {
      await fn(c);
    } finally {
      await c.end();
    }
  };
  const restoreEnv = (over: Record<string, string | undefined> = {}) => ({
    ...process.env,
    T2F_ENV: 'test',
    T2F_BACKUP_KEY: TEST_BACKUP_KEY,
    DATABASE_URI: restoreUri,
    T2F_RESTORE_TMP: tmpRoot,
    ...over,
  });
  const pull = async (args: string[], env: Record<string, string | undefined>, wrap?: (s: ObjectStore) => ObjectStore) => {
    const t = io();
    const cliDeps: OpsCliDeps = {
      open: () => Promise.reject(new Error('not used')),
      openRestore: (manifestOnly) =>
        restorePortsOf(env, manifestOnly, {
          runner: () => runner,
          ...(wrap
            ? {
                store: (v) =>
                  wrap(createS3ObjectStore({ endpoint: v.T2F_R2_ENDPOINT, bucket: v.T2F_R2_BUCKET, accessKeyId: v.T2F_R2_ACCESS_KEY_ID, secretAccessKey: v.T2F_R2_SECRET_ACCESS_KEY })),
              }
            : {}),
        }),
      now: Date.now,
    };
    const code = await runOps(['restore-pull', ...args], t.io, cliDeps);
    return { code, out: t.out, err: t.err };
  };

  beforeAll(async () => {
    r2 = r2Env();
    backups = `${r2.prefix}backups/db/`;
    const facts = createPayloadBackupFacts(() => payloadOf(deps)());
    const dump = await testDumpRunner(String(process.env.DATABASE_URI), () => facts.serverVersion());
    deps = testDeps({ backupTuning: { dump } }, { T2F_BACKUP_KEY: TEST_BACKUP_KEY });
    payload = await payloadOf(deps)();
    await deleteUnder(r2, backups);

    const u = new URL(String(process.env.DATABASE_URI));
    restoreDb = `${decodeURIComponent(u.pathname.slice(1)).replace(/_test$/, '')}_restore`;
    expect(restoreDb).toMatch(RESTORE_DB);
    u.pathname = '/postgres';
    adminUri = u.toString();
    u.pathname = `/${restoreDb}`;
    restoreUri = u.toString();
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${restoreDb}"`);
      await c.query(`CREATE DATABASE "${restoreDb}"`);
    });
    runner = await testRestoreRunner(restoreUri);
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 't2f-ops-cli-'));
  });

  afterAll(async () => {
    await deleteUnder(r2, backups).catch(() => undefined);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    if (restoreDb && RESTORE_DB.test(restoreDb)) await admin((c) => c.query(`DROP DATABASE IF EXISTS "${restoreDb}" WITH (FORCE)`).then(() => undefined)).catch(() => undefined);
  });

  it('AC-38: ops status prints the overview JSON and writes nothing', async () => {
    const facts = createPayloadBackupFacts(() => payloadOf(deps)());
    const before = { ...(await facts.rowCounts()), audit: await count('audit_log'), spend: await count('spend_counters'), restore: await count('restore_runs') };
    const r = cli(['status']);
    expect(r.status, r.stderr).toBe(0);
    const parsed = OverviewSchema.safeParse(JSON.parse(r.last));
    expect(parsed.success).toBe(true);
    expect(r.last).not.toContain(TEST_BACKUP_KEY);
    const after = { ...(await facts.rowCounts()), audit: await count('audit_log'), spend: await count('spend_counters'), restore: await count('restore_runs') };
    expect(after).toEqual(before);
  });

  it('AC-52: backup-now makes a manual copy and prints the key and the manifest', async () => {
    const t = io();
    const code = await runOps(['backup-now'], t.io, { open: async () => ({ ...(await opsPortsOf(deps)), close: async () => undefined }), openRestore: () => 'unused', now: Date.now });
    expect(code, t.err.join('\n')).toBe(0);
    const printed = JSON.parse(t.out[0]!) as { ok: boolean; key: string; manifest: { key: string; sha256: string; rowCounts: Record<string, number> } };
    expect(printed.ok).toBe(true);
    expect(printed.manifest.key).toBe(printed.key);
    expect(await listKeys(r2, backups)).toEqual([printed.key, printed.key.replace(/\.dump\.enc$/, '.manifest.json')].sort());
    const run = (await payload.find({ collection: 'backup-runs', where: { key: { equals: printed.key } }, overrideAccess: true, depth: 0 })).docs[0];
    expect(run).toMatchObject({ kind: 'manual', result: 'ok' });
    backupKey = printed.key;
    manifest = printed.manifest;
  });

  it('AC-56: restore-record writes a restore-runs row and a journal line; the overview shows it', async () => {
    const at = '2026-11-20T10:00:00.000Z';
    const r = cli(['restore-record', '--at', at, '--key', backupKey, '--duration-ms', '93000', '--loss-ms', '3600000', '--result', 'ok', '--target', 'local']);
    expect(r.status, r.stderr).toBe(0);
    const rows = (await payload.find({ collection: 'restore-runs', where: { key: { equals: backupKey } }, overrideAccess: true, depth: 0 })).docs;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: 'ok', durationMs: 93000, lossWindowMs: 3600000, target: 'local' });
    const lines = (await payload.find({ collection: 'audit-log', where: { action: { equals: RESTORE_RECORD_ACTION } }, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs;
    expect(lines).toHaveLength(1);
    const overview = await buildOverview(await overviewSourcesOf(deps));
    expect(overview.blocks.backups?.lastRestore).toMatchObject({ result: 'ok', durationMs: 93000, lossWindowMs: 3600000 });

    const bad = cli(['restore-record', '--at', at, '--key', backupKey, '--duration-ms', 'x', '--result', 'ok', '--target', 'local']);
    expect(bad.status).toBe(2);
  });

  it('AC-63: spend-record server moves the server row and writes a journal line', async () => {
    const period = monthPeriod(Date.now());
    const read = async () =>
      (await db().execute(sql`SELECT "amount_micros", "meta" FROM "spend_counters" WHERE "row" = 'server' AND "period" = ${period}`)).rows[0];
    const before = await read();
    const r = cli(['spend-record', 'server', '--hours', '2', '--usd-per-hour', '0.5', '--reason', 'capacity back']);
    expect(r.status, r.stderr).toBe(0);
    const after = await read();
    expect(Number(after?.amount_micros) - Number(before?.amount_micros ?? 0)).toBe(1_000_000);
    const hours = (m: unknown) => Number((m as { hours?: unknown } | undefined)?.hours ?? 0);
    expect(hours(after?.meta) - hours(before?.meta)).toBe(2);
    const lines = (await payload.find({ collection: 'audit-log', where: { action: { equals: SPEND_RECORD_ACTION } }, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs;
    expect(lines[0]).toMatchObject({ action: SPEND_RECORD_ACTION });
    expect(cli(['spend-record', 'server', '--hours', '2', '--usd-per-hour', '0.5', '--reason', 'x'.repeat(201)]).status).toBe(2);
  });

  it('AC-53/55/59: restore-pull verifies before pg_restore, refuses unsafe targets, cleans its temp dir, restores a good copy', async () => {
    const manifestOnly = await pull(['--manifest-only'], { ...process.env });
    expect(manifestOnly.code, manifestOnly.err.join('\n')).toBe(0);
    expect(JSON.parse(manifestOnly.out[0]!)).toMatchObject({ ok: true, manifest: { key: backupKey } });

    const flipped = await pull(['--key', 'latest'], restoreEnv(), flipping);
    expect(flipped.code).toBe(3);
    expect(flipped.err.join('\n')).toContain('sha256');
    expect(readdirSync(tmpRoot)).toEqual([]);

    const otherKey = await pull(['--key', backupKey], restoreEnv({ T2F_BACKUP_KEY: OTHER_BACKUP_KEY }));
    expect(otherKey.code).toBe(3);
    expect(otherKey.err.join('\n')).toContain('key-id');
    expect(readdirSync(tmpRoot)).toEqual([]);

    const notEmpty = await pull([], restoreEnv({ DATABASE_URI: String(process.env.DATABASE_URI) }));
    expect(notEmpty.code).toBe(2);
    expect(notEmpty.err.join('\n')).toContain('target-not-empty');

    const production = await pull([], restoreEnv({ T2F_ENV: undefined }));
    expect(production.code).toBe(2);
    expect(readdirSync(tmpRoot)).toEqual([]);

    const good = await pull(['--key', backupKey], restoreEnv());
    expect(good.code, good.err.join('\n')).toBe(0);
    expect(JSON.parse(good.out[0]!)).toMatchObject({ ok: true, key: backupKey });
    expect(readdirSync(tmpRoot)).toEqual([]);
    const c = new pg.Client({ connectionString: restoreUri });
    await c.connect();
    try {
      for (const [slug, table] of [['countries', 'countries'], ['zones', 'zones']] as const) {
        const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
        expect(rows[0]?.n, slug).toBe(manifest.rowCounts[slug]);
      }
    } finally {
      await c.end();
    }
  });
});
