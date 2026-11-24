// @ts-check
// SPEC-13b W45 — `ops backup --now` на фейках (AC-52): у контейнер сервера йде рівно `pnpm run ops backup-now`,
// друкуються ключ і маніфест (відповідь — ОСТАННІЙ рядок stdout), крок у журналі вузла; production — лише з
// `--confirm production` і `--allow-main-domain`; prelaunch і вузол без сервера — відмова до копії.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { BACKUP_NOW_ARGS, lastJsonLine } from '../lib/backup.mjs';
import { parseJournal } from '../lib/journal.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const SHA = 'b'.repeat(40);
const NOW = new Date('2026-11-24T10:00:00.000Z');
const KEY = 'rehearsal/backups/db/20261124T100000Z.dump.enc';
const MANIFEST = { format: 'T2FB1', key: KEY, size: 1234, sha256: 'f'.repeat(64), keyId: '0a1b2c3d', snapshotAt: NOW.toISOString(), durationMs: 900, pgVersion: 17, lastMigration: '20261124_ops', rowCounts: { countries: 3 }, commit: SHA };

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {{ code?: number, stdout?: string, stderr?: string }} answer @param {{ running?: boolean, env?: string }} [o] */
function world(answer, o = {}) {
  const env = o.env ?? 'rehearsal';
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-13b-backup-'));
  cleanups.push(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const nodeDir = path.join(stateRoot, `node-local-${env}`);
  fs.mkdirSync(nodeDir, { recursive: true });
  if (o.running !== false) fs.writeFileSync(path.join(nodeDir, 'current.env'), `T2F_ENV=${env}\nT2F_SERVER_SHA=${SHA}\n`);
  const fx = createFakeExec([{ match: (c) => c.argv.includes('backup-now'), result: answer }]);
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
    ...FAKE_TARGET,
  };
  const journal = () => {
    const f = path.join(nodeDir, 'journal.jsonl');
    return fs.existsSync(f) ? parseJournal(fs.readFileSync(f, 'utf8')) : [];
  };
  return { fx, out, err, deps, journal, nodeDir };
}

const OK = { code: 0, stdout: `[payload] connected\n{"level":"info","msg":"backup"}\n${JSON.stringify({ ok: true, key: KEY, manifest: MANIFEST })}\n` };

describe('backup --now (AC-52)', () => {
  it('runs exactly `pnpm run ops backup-now` in the server container, prints key and manifest, journals the step', async () => {
    const w = world(OK);
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local', '--now'], w.deps)).toBe(0);
    const calls = w.fx.calls.filter((c) => c.argv[0] === 'docker');
    expect(calls).toHaveLength(1);
    const argv = calls[0].argv;
    expect(argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 't2f-node-rehearsal']);
    expect(argv.slice(-BACKUP_NOW_ARGS.length)).toEqual([...BACKUP_NOW_ARGS]);
    expect(argv).toContain(path.join(w.nodeDir, 'current.env'));
    expect(w.out.join('\n')).toContain(`ключ ${KEY}`);
    expect(w.out.join('\n')).toContain('"sha256"');
    const steps = w.journal().filter((r) => r.kind === 'step' && r.step === 'backup-now');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'ok', env: 'rehearsal', commit: SHA });
  });

  it('a refusal of the server (exit 2) → code 2, journal `failed`', async () => {
    const w = world({ code: 2, stdout: '', stderr: 'ops: backup refused (not-configured)\n' });
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local', '--now'], w.deps)).toBe(2);
    expect(w.err.join('\n')).toContain('not-configured');
    expect(w.journal().filter((r) => r.kind === 'step')[0]).toMatchObject({ step: 'backup-now', status: 'failed' });
  });

  it('a failed copy (exit 1) or a non-JSON last line → code 1', async () => {
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local', '--now'], world({ code: 1, stderr: 'ops: backup failed (stage dump)' }).deps)).toBe(1);
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local', '--now'], world({ code: 0, stdout: 'not json' }).deps)).toBe(1);
  });

  it('no running server on the node → code 2 before any docker call', async () => {
    const w = world(OK, { running: false });
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local', '--now'], w.deps)).toBe(2);
    expect(w.fx.calls).toEqual([]);
  });

  it('production needs --confirm production and --allow-main-domain; prelaunch is refused; --now is required', async () => {
    const p = world(OK, { env: 'production' });
    expect(await main(['backup', '--env', 'production', '--target', 'local', '--now'], p.deps)).toBe(2);
    expect(await main(['backup', '--env', 'production', '--target', 'local', '--now', '--confirm', 'production'], p.deps)).toBe(2);
    expect(p.fx.calls).toEqual([]);
    expect(await main(['backup', '--env', 'production', '--target', 'local', '--now', '--confirm', 'production', '--allow-main-domain'], p.deps)).toBe(0);
    expect(p.fx.calls.filter((c) => c.argv.includes('backup-now'))).toHaveLength(1);

    const pre = world(OK);
    expect(await main(['backup', '--env', 'prelaunch', '--target', 'local', '--now', '--confirm', 'prelaunch', '--allow-main-domain'], pre.deps)).toBe(2);
    expect(await main(['backup', '--env', 'rehearsal', '--target', 'local'], pre.deps)).toBe(2);
    expect(pre.fx.calls).toEqual([]);
  });

  it('lastJsonLine takes the last line only', () => {
    expect(lastJsonLine('{"a":1}\n{"b":2}\n')).toEqual({ b: 2 });
    expect(lastJsonLine('{"a":1}\nplain\n')).toBeNull();
    expect(lastJsonLine('')).toBeNull();
  });
});
