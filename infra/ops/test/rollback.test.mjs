// @ts-check
// W21 — відкат на фейках: Worker спершу, потім сервер (AC-24), без міграцій і без запису файлів змінних (AC-25),
// відмова без цілі чи образу (AC-26), покоління секрету краю (AC-27), без `down` (AC-19), EC-8, сторожові значення (NFR-4).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import {
  HOST,
  okRecord,
  scenario,
  SENTINEL_EDGE,
  SENTINEL_TOKEN,
  SHA_A,
  SHA_B,
  SHA_C,
  V_NEW,
  V_OLD,
} from './support/scenario.mjs';

const LOCAL = ['rollback', '--env', 'rehearsal', '--target', 'local'];
const NODE_ENV_FILES = ['server.env', 'postgres.env', 'cloudflared.env'];

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** Вузол після успішного розгортання B поверх A: працює B, Worker — V_NEW. @param {Parameters<typeof scenario>[0]} [o] */
function deployed(o = {}) {
  const sc = scenario({ running: SHA_B, images: [SHA_A, SHA_B], ...o });
  cleanups.push(sc.cleanup);
  sc.st.version = V_NEW;
  sc.seedJournal([okRecord()]);
  return sc;
}

/** @param {ReturnType<typeof scenario>} sc */
const rollbacks = (sc) => sc.journal().filter((r) => r.kind === 'rollback');
/** @param {ReturnType<typeof scenario>} sc */
const swaps = (sc) => sc.fx.calls.filter((c) => c.argv.includes('--force-recreate'));
/** Виклики, що щось змінюють: усе, крім читання стану. @param {ReturnType<typeof scenario>} sc */
const changing = (sc) =>
  sc.fx.calls.filter((c) => {
    const a = c.argv.join(' ');
    return !/deployments status|docker image inspect|test ! -e/.test(a);
  });

/** @param {ReturnType<typeof scenario>} sc */
function assertNoMigrateNoDownNoSentinel(sc) {
  for (const c of sc.fx.calls) {
    expect(c.argv.join(' ')).not.toMatch(/migrate/);
    expect(c.argv).not.toContain('down');
  }
  const all = [...sc.out, ...sc.err, sc.journalText()].join('\n');
  expect(all).not.toContain(SENTINEL_EDGE);
  expect(all).not.toContain(SENTINEL_TOKEN);
}

describe('rollback refusals before any change (AC-26, AC-27)', () => {
  it('an empty journal → code 2, 0 wrangler, 0 docker', async () => {
    const sc = scenario({ running: SHA_B, images: [SHA_A, SHA_B] });
    cleanups.push(sc.cleanup);
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('немає успішного розгортання');
    expect(sc.wranglerCalls()).toEqual([]);
    expect(sc.dockerCalls()).toEqual([]);
    expect(sc.journal()).toEqual([]);
  });

  it('the target image is missing on the node → code 2, 0 wrangler, only the image lookup', async () => {
    const sc = deployed({ images: [SHA_B] });
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain(`t2f-server:${SHA_A}`);
    expect(sc.wranglerCalls()).toEqual([]);
    expect(sc.dockerCalls().map((c) => c.argv.join(' '))).toEqual([`docker image inspect t2f-server:${SHA_A}`]);
    expect(rollbacks(sc)).toEqual([]);
  });

  it('a record without imageBefore and no --to → code 2', async () => {
    const sc = deployed();
    sc.seedJournal([okRecord({ imageBefore: null })]);
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('--to');
    expect(changing(sc)).toEqual([]);
  });

  it('a record without workerVersionBefore → code 2', async () => {
    const sc = deployed();
    sc.seedJournal([okRecord({ workerVersionBefore: null })]);
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.wranglerCalls()).toEqual([]);
  });

  it('generation 1 while the current edge-secret generation is 2 → refusal explaining the edge secret', async () => {
    const sc = deployed();
    sc.seedJournal([okRecord(), { kind: 'edge-secret', at: '2026-11-16T12:00:00.000Z', env: 'rehearsal', generation: 2 }]);
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('секрет краю');
    expect(sc.wranglerCalls()).toEqual([]);
    expect(sc.dockerCalls()).toEqual([]);
  });
});

describe('rollback (AC-24, AC-25)', () => {
  it('rolls the Worker back to workerVersionBefore first, then swaps the server to imageBefore', async () => {
    const sc = deployed();
    // Файли змінних вузла існують і не мають змінитися.
    for (const f of NODE_ENV_FILES) fs.writeFileSync(sc.nodeFile(f), `# ${f}\n`);
    const before = NODE_ENV_FILES.map((f) => fs.readFileSync(sc.nodeFile(f), 'utf8'));

    expect(await main(LOCAL, sc.deps())).toBe(0);

    const order = sc.fx.calls.map((c) => c.argv.join(' '));
    const iRollback = order.findIndex((a) => a.includes(`rollback ${V_OLD} -m t2f rollback -y --env rehearsal`));
    const iSwap = order.findIndex((a) => a.includes('--force-recreate server'));
    expect(iRollback).toBeGreaterThanOrEqual(0);
    expect(iRollback).toBeLessThan(iSwap);
    expect(swaps(sc)[0].argv).toContain(sc.nodeFile('next.env'));
    expect(sc.st.running).toBe(SHA_A);
    expect(sc.st.version).toBe(V_OLD);
    expect(sc.readAt(sc.nodeFile('current.env'))).toBe(`T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA_A}\n`);

    const steps = sc.journal().flatMap((r) => (r.kind === 'step' && r.status !== 'start' ? [`${r.step}:${r.status}`] : []));
    expect(steps).toEqual(['worker-rollback:ok', 'swap:ok', 'health:ok', 'total:ok']);
    expect(rollbacks(sc)).toEqual([
      {
        kind: 'rollback',
        at: '2026-11-17T10:00:00.000Z',
        env: 'rehearsal',
        commit: SHA_A,
        imageBefore: `t2f-server:${SHA_B}`,
        imageAfter: `t2f-server:${SHA_A}`,
        workerVersionBefore: V_NEW,
        workerVersionAfter: V_OLD,
        edgeSecretGeneration: 1,
        result: 'rolled-back',
        failedStep: null,
      },
    ]);
    // Тривалість Worker’а і всієї команди — у записах кроків (NFR-1).
    const total = sc.journal().find((r) => r.kind === 'step' && r.step === 'total');
    expect(total && total.kind === 'step' && typeof total.ms).toBe('number');

    // AC-25: файли змінних вузла не змінено; записано лише файли інтерполяції ops.
    expect(NODE_ENV_FILES.map((f) => fs.readFileSync(sc.nodeFile(f), 'utf8'))).toEqual(before);
    expect(fs.readdirSync(path.dirname(sc.nodeFile('x'))).sort()).toEqual(['cloudflared.env', 'current.env', 'journal.jsonl', 'next.env', 'postgres.env', 'server.env']);
    assertNoMigrateNoDownNoSentinel(sc);
  });

  it('--to overrides the image target', async () => {
    const sc = deployed({ images: [SHA_A, SHA_B, SHA_C] });
    expect(await main([...LOCAL, '--to', SHA_C], sc.deps())).toBe(0);
    expect(sc.st.running).toBe(SHA_C);
    expect(rollbacks(sc)[0]).toMatchObject({ commit: SHA_C, imageAfter: `t2f-server:${SHA_C}`, workerVersionAfter: V_OLD });
  });

  it('EC-8: the Worker rolled back but the server stays unhealthy → failed with failedStep health, code 1', async () => {
    const sc = deployed();
    sc.st.healthy = (sha) => sha === SHA_B;
    expect(await main(LOCAL, sc.deps())).toBe(1);
    expect(sc.st.version).toBe(V_OLD);
    expect(rollbacks(sc)[0]).toMatchObject({ result: 'failed', failedStep: 'health', workerVersionAfter: V_OLD, imageAfter: null });
    expect(sc.err.join('\n')).toContain('Worker повернено');
    // `current.env` не переписано на образ, що не став здоровим.
    expect(sc.readAt(sc.nodeFile('current.env'))).toContain(SHA_B);
    assertNoMigrateNoDownNoSentinel(sc);
  });

  it('a failed Worker rollback leaves the server untouched', async () => {
    const sc = deployed();
    sc.st.wrangler.rollback = 1;
    expect(await main(LOCAL, sc.deps())).toBe(1);
    expect(swaps(sc)).toEqual([]);
    expect(sc.st.running).toBe(SHA_B);
    expect(rollbacks(sc)[0]).toMatchObject({ result: 'failed', failedStep: 'worker-rollback', workerVersionAfter: V_NEW });
  });

  it('--probe records downtimeSeconds in the rollback record', async () => {
    const sc = deployed();
    const startProbe = () => ({ stop: () => ({ downtimeSeconds: 4, samples: 9, failures: 4 }) });
    expect(await main([...LOCAL, '--probe'], sc.deps({ startProbe }))).toBe(0);
    expect(rollbacks(sc)[0]).toMatchObject({ result: 'rolled-back', downtimeSeconds: 4 });
  });

  it('over ssh: Worker first, then the swap on the node; no write to the node env files', async () => {
    const sc = deployed({ target: HOST, nodeImages: [SHA_A, SHA_B] });
    expect(await main(['rollback', '--env', 'rehearsal', '--target', HOST], sc.deps())).toBe(0);
    const writes = sc.fx.callsOf(`ssh:${HOST}`).filter((c) => c.argv[0] === 'sh' && c.argv[2].startsWith('cat > "'));
    expect(writes.map((c) => c.argv[4])).toEqual(['/srv/t2f/rehearsal/next.env', '/srv/t2f/rehearsal/current.env']);
    expect(sc.remoteFiles.get('/srv/t2f/rehearsal/current.env')).toContain(SHA_A);
    assertNoMigrateNoDownNoSentinel(sc);
  });
});
