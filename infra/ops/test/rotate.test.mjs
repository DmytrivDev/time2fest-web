// @ts-check
// W23 — заміна секрету краю на фейках (AC-37, NFR-4): порядок (1)…(4), покоління +1, невдача (3) лишає PREVIOUS
// і не виконує (4), жоден секрет — поза stdin.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { getVar } from '../lib/secrets/envFile.mjs';
import { PUSH_SCRIPT } from '../lib/secrets/files.mjs';
import { HOST, scenario, SHA_B } from './support/scenario.mjs';

const OLD = 'old-edge-secret-sentinel-0123456789abcdefABCD'; // check-secrets: allow
const ROTATE = ['edge-secret', '--env', 'rehearsal', '--rotate'];
const STEPS = ['edge-secret:server', 'edge-secret:worker', 'edge-secret:check', 'edge-secret:drop-previous'];

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {Parameters<typeof scenario>[0]} [o] */
function world(o = {}) {
  const sc = scenario({ running: SHA_B, images: [SHA_B], ...o });
  cleanups.push(sc.cleanup);
  const localFile = path.join(sc.stateRoot, 'rehearsal', 'server.env');
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  fs.writeFileSync(localFile, `# names only\nREDIS_URL=redis://redis:6379/0\nT2F_EDGE_SECRET=${OLD}\nT2F_EDGE_SECRET_PREVIOUS=\n`);

  /** Події в порядку виконання: надсилання файлу, перестворення сервера, запис Worker’а, перевірка краю. */
  const events = /** @type {string[]} */ ([]);
  /** Вміст server.env, що пішов на вузол (лише з stdin). */
  const pushed = /** @type {string[]} */ ([]);
  /** @type {{ name: string, value: string }[]} */
  const puts = [];
  const worker = {
    putCode: 0,
    missingCredentials: () => [],
    /** @param {string} name @param {string} value */
    async putSecret(name, value) {
      events.push('worker');
      puts.push({ name, value });
      return this.putCode === 0 ? { code: 0 } : { code: 1, message: 'wrangler secret put завершився з кодом 1' };
    },
  };

  const local = o.target === undefined || o.target === 'local';
  const base = local ? sc.exec.localTransport() : /** @type {import('../lib/exec.mjs').Transport} */ (sc.transport);
  /** @type {import('../lib/exec.mjs').Transport} */
  const transport = {
    ...base,
    async exec(argv, opts = {}) {
      if (argv[2] === PUSH_SCRIPT) {
        events.push('push');
        pushed.push(String(opts.input));
      }
      if (argv.includes('--force-recreate')) events.push('recreate');
      if (argv.includes('--secret')) events.push('check');
      return base.exec(argv, opts);
    },
  };
  const edge = { ok: true };
  /** @param {object} [extra] */
  const deps = (extra = {}) =>
    sc.deps({
      transport: () => transport,
      worker: () => worker,
      platform: 'linux',
      edgeCheck: async () => {
        events.push('check');
        return edge.ok;
      },
      ...extra,
    });
  /** Поточний server.env вузла (локальна ціль — файл у каталозі стану; вузол — останнє надіслане). */
  const nodeServerEnv = () => (local ? fs.readFileSync(sc.nodeFile('server.env'), 'utf8') : pushed[pushed.length - 1]);
  return { sc, localFile, events, pushed, puts, worker, edge, deps, nodeServerEnv };
}

/** @param {ReturnType<typeof world>} w */
const stepRecords = (w) => w.sc.journal().filter((r) => r.kind === 'step');
/** @param {ReturnType<typeof world>} w */
const generations = (w) => w.sc.journal().flatMap((r) => (r.kind === 'edge-secret' ? [r.generation] : []));

/** @param {ReturnType<typeof world>} w @param {string[]} values */
function expectNowhere(w, values) {
  const visible = [JSON.stringify(w.sc.fx.calls), w.sc.out.join('\n'), w.sc.err.join('\n'), w.sc.journalText()].join('\n');
  for (const v of values) expect(visible.includes(v)).toBe(false);
}

describe('edge-secret --rotate', () => {
  it('runs (1) server with both, (2) Worker, (3) edge check, (4) drop previous — in this order', async () => {
    const w = world({ target: HOST });
    expect(await main([...ROTATE, '--target', HOST], w.deps())).toBe(0);

    expect(stepRecords(w).map((r) => `${r.step}:${r.status}`)).toEqual(STEPS.flatMap((s) => [`${s}:start`, `${s}:ok`]));
    expect(w.events).toEqual(['push', 'recreate', 'worker', 'check', 'push', 'recreate']);

    const fresh = w.puts[0].value;
    expect(w.puts).toEqual([{ name: 'T2F_EDGE_SECRET', value: fresh }]);
    expect(fresh.length).toBeGreaterThanOrEqual(43);
    expect(fresh).not.toBe(OLD);
    // (1): новий + старий як PREVIOUS; (4): лише новий.
    expect(getVar(w.pushed[0], 'T2F_EDGE_SECRET')).toBe(fresh);
    expect(getVar(w.pushed[0], 'T2F_EDGE_SECRET_PREVIOUS')).toBe(OLD);
    expect(getVar(w.pushed[1], 'T2F_EDGE_SECRET')).toBe(fresh);
    expect(getVar(w.pushed[1], 'T2F_EDGE_SECRET_PREVIOUS')).toBeUndefined();
    expect(getVar(w.pushed[1], 'REDIS_URL')).toBe('redis://redis:6379/0');
    // `.local` = вузол.
    expect(fs.readFileSync(w.localFile, 'utf8')).toBe(w.pushed[1]);
    // Під замком вузла; сервер — той самий образ.
    expect(w.sc.fx.calls.some((c) => c.argv[0] === 'flock')).toBe(true);
    expect(w.sc.st.running).toBe(SHA_B);
    expectNowhere(w, [OLD, fresh]);
  });

  it('increments the edge-secret generation in the journal', async () => {
    const w = world();
    w.sc.seedJournal([{ kind: 'edge-secret', at: '2026-11-16T10:00:00.000Z', env: 'rehearsal', generation: 2 }]);
    expect(await main([...ROTATE, '--target', 'local'], w.deps())).toBe(0);
    expect(generations(w)).toEqual([2, 3]);

    const again = await main([...ROTATE, '--target', 'local'], w.deps());
    expect(again).toBe(0);
    expect(generations(w)).toEqual([2, 3, 4]);
    // Друга заміна бере за «старий» секрет першої заміни.
    expect(w.puts.map((p) => p.value)[1]).not.toBe(w.puts[0].value);
    expect(getVar(w.nodeServerEnv(), 'T2F_EDGE_SECRET')).toBe(w.puts[1].value);
    expect(getVar(w.nodeServerEnv(), 'T2F_EDGE_SECRET_PREVIOUS')).toBeUndefined();
  });

  it('local target checks with the in-container probe using the current secret', async () => {
    const w = world();
    expect(await main([...ROTATE, '--target', 'local'], w.deps())).toBe(0);
    const probe = w.sc.fx.calls.find((c) => c.argv.includes('--secret'));
    expect(probe?.argv.slice(-6)).toEqual(['-T', 'server', 'node', 'scripts/health-probe.mjs', '--secret', 'current']);
    expect(probe?.argv.some((a) => a.endsWith('current.env'))).toBe(true);
    expect(w.events).toEqual(['recreate', 'worker', 'check', 'recreate']);
  });

  it('a failed edge check leaves PREVIOUS in the pushed file and does not run (4)', async () => {
    const w = world({ target: HOST });
    w.edge.ok = false;
    expect(await main([...ROTATE, '--target', HOST], w.deps())).toBe(1);

    expect(stepRecords(w).map((r) => `${r.step}:${r.status}`)).toEqual([
      'edge-secret:server:start', 'edge-secret:server:ok',
      'edge-secret:worker:start', 'edge-secret:worker:ok',
      'edge-secret:check:start', 'edge-secret:check:failed',
    ]);
    expect(w.pushed).toHaveLength(1);
    expect(getVar(w.pushed[0], 'T2F_EDGE_SECRET_PREVIOUS')).toBe(OLD);
    expect(w.events.filter((e) => e === 'recreate')).toHaveLength(1);
    expect(getVar(fs.readFileSync(w.localFile, 'utf8'), 'T2F_EDGE_SECRET_PREVIOUS')).toBe(OLD);
    expect(w.sc.err.join('\n')).toContain('T2F_EDGE_SECRET_PREVIOUS лишився');
    // Worker уже з новим секретом — покоління змінилося.
    expect(generations(w)).toEqual([2]);
    expectNowhere(w, [OLD, w.puts[0].value]);
  });

  it('a failed Worker write stops before the edge check and keeps the generation', async () => {
    const w = world();
    w.worker.putCode = 1;
    expect(await main([...ROTATE, '--target', 'local'], w.deps())).toBe(1);
    expect(w.events).toEqual(['recreate', 'worker']);
    expect(getVar(w.nodeServerEnv(), 'T2F_EDGE_SECRET_PREVIOUS')).toBe(OLD);
    expect(generations(w)).toEqual([]);
  });

  it('refuses with 2 when no server runs on the node', async () => {
    const w = world({ running: null });
    expect(await main([...ROTATE, '--target', 'local'], w.deps())).toBe(2);
    expect(w.events).toEqual([]);
    expect(w.puts).toEqual([]);
  });

  it('refuses with 2 without a generated .local server.env', async () => {
    const w = world();
    fs.rmSync(w.localFile);
    expect(await main([...ROTATE, '--target', 'local'], w.deps())).toBe(2);
    expect(w.sc.err.join('\n')).toContain('спершу --generate');
    expect(w.events).toEqual([]);
  });
});
