// @ts-check
// SPEC-13a W33 — локальний вузол, частина 2: збої, відкат і заміна секрету краю справжнім Docker
// (HEAVY, під винятковим замком машини). AC-12, AC-13, AC-24, AC-25, AC-37 (+ AC-2: хибний `T2F_HOST`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, createSuite, docker, sha256File, sleep, syntheticSha } from './support.mjs';

const s = createSuite('failure');
const DEPLOY = ['deploy', '--env', ENV, '--target', 'local'];
/**
 * Міграція, що навмисно падає. Payload CLI читає кожен `*.ts` теки міграцій, крім `index.ts`
 * (`payload/dist/database/migrations/readMigrationFiles.js`), тому додається окремий файл, а не заміна `index.ts`.
 */
const FAILING_MIGRATION_PATH = '/app/server/src/migrations/20991231_000000_t2f_node_suite_fail.ts';
const FAILING_MIGRATION = `export async function up(): Promise<void> {
  throw new Error('t2f-node-suite: deliberate migration failure');
}

export async function down(): Promise<void> {}
`;

/** Рядок `deploy` журналу для коміту (останній). @param {string} sha */
const deployRecord = (sha) => /** @type {Record<string, unknown> | undefined} */ (s.journal().filter((r) => r.kind === 'deploy' && r.commit === sha).pop());

/** Кількість рядків `payload_migrations` у Postgres вузла. */
async function migrationsCount() {
  const user = s.nodeVar('postgres.env', 'POSTGRES_USER') ?? '';
  const db = s.nodeVar('postgres.env', 'POSTGRES_DB') ?? '';
  const r = await s.compose(['exec', '-T', 'postgres', 'psql', '-U', user, '-d', db, '-tAc', 'select count(*) from payload_migrations']);
  expect(r.code, r.stderr).toBe(0);
  return Number(r.stdout.trim());
}

beforeAll(async () => {
  await s.setup();
  const r = await s.ops(DEPLOY);
  if (r.code !== 0) throw new Error(`базове розгортання → ${r.code}\n${r.text}`);
  await s.pinBase();
});

afterAll(async () => {
  await s.cleanup();
});

describe('local node: failures, rollback, rotation (W33)', () => {
  it('AC-12: a failing migration keeps the previous server, no Worker call, exit ≠0 naming the migrate step', async () => {
    const sha = await s.derive(syntheticSha('failure-migrate'), { files: { [FAILING_MIGRATION_PATH]: FAILING_MIGRATION } });
    const mark = s.worker.calls.length;
    const r = await s.ops([...DEPLOY, '--commit', sha]);
    expect(r.code, r.text).toBe(1);
    expect(deployRecord(sha)).toMatchObject({ result: 'failed', failedStep: 'migrate' });
    expect(s.worker.calls.slice(mark)).toEqual([]);
    expect(await s.healthLine()).toBe(`200 ${s.base}`);
    expect(s.nodeVar('current.env', 'T2F_SERVER_SHA')).toBe(s.base);
  });

  it('AC-13: a server that does not start is swapped back within 90 s, no Worker call, exit ≠0', async () => {
    // Хибна змінна образу тут не годиться: `environment:` Compose (compose.yml: T2F_HOST: 0.0.0.0) перекриває
    // `T2F_HOST` образу, а хибний `T2F_COMMIT` валить уже крок міграцій (схема змінних у конфігурації Payload).
    // Тому образ, що не стартує, — похідний з командою запуску, яка одразу виходить з 1; `pnpm migrate` у ньому працює.
    const sha = await s.derive(syntheticSha('failure-start'), { cmd: ['sh', '-c', 'echo t2f-node-suite: server deliberately not starting >&2; exit 1'] });
    const mark = s.worker.calls.length;
    const from = s.journal().length;
    const r = await s.ops([...DEPLOY, '--commit', sha]);
    expect(r.code, r.text).toBe(1);
    expect(deployRecord(sha)).toMatchObject({ result: 'failed', failedStep: 'health', imageAfter: `t2f-server:${s.base}` });
    const swapToBack = ['swap', 'health', 'swap-back'].map((st) => s.stepMs(sha, st, from) ?? Infinity).reduce((a, b) => a + b, 0);
    console.log(`[p12-timing] AC-13 swap → previous healthy ${swapToBack} ms`);
    expect(swapToBack).toBeLessThanOrEqual(90_000);
    expect(s.worker.calls.slice(mark)).toEqual([]);
    expect(await s.healthLine()).toBe(`200 ${s.base}`);
  });

  it('AC-2: a malformed T2F_HOST makes the image exit ≠0 naming the variable', async () => {
    const r = await docker([
      'run', '--rm', '--env-file', s.nodeFile('server.env'),
      '-e', 'T2F_ENV=rehearsal', '-e', 'T2F_HOST=bad host', '-e', 'T2F_SERVER_PORT=3000',
      `t2f-node-suite-base:failure`,
    ], { timeoutMs: 120_000 });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('T2F_HOST');
  });

  it('AC-24, AC-25: rollback after A → B returns the Worker first, then the server to A; no migration, node env file unchanged', async () => {
    const versionAfterA = /** @type {string} */ (deployRecord(s.base)?.workerVersionAfter);
    expect(versionAfterA).toMatch(/^[0-9a-f-]{36}$/);
    const b = await s.derive(syntheticSha('failure-rollback-b'));
    const d = await s.ops([...DEPLOY, '--commit', b]);
    expect(d.code, d.text).toBe(0);
    expect(await s.healthLine()).toBe(`200 ${b}`);

    const countBefore = await migrationsCount();
    const envBefore = sha256File(s.nodeFile('server.env'));
    const mark = s.worker.calls.length;
    const from = s.journal().length;
    const r = await s.ops(['rollback', '--env', ENV, '--target', 'local']);
    expect(r.code, r.text).toBe(0);
    console.log(`[p12-timing] rollback total ${s.stepMs(s.base, 'total', from)} ms (swap ${s.stepMs(s.base, 'swap', from)}, health ${s.stepMs(s.base, 'health', from)})`);
    expect(s.worker.calls[mark]).toBe(`rollback ${versionAfterA}`);
    expect(await s.healthLine()).toBe(`200 ${s.base}`);
    expect(await migrationsCount()).toBe(countBefore);
    expect(sha256File(s.nodeFile('server.env'))).toBe(envBefore);
    expect(s.journal().slice(from).some((x) => x.kind === 'step' && /** @type {{ step: string }} */ (x).step === 'migrate')).toBe(false);
  });

  it('AC-37: rotation — a client sending the old secret, then the new one after the Worker gets it, never sees 404', async () => {
    const old = /** @type {string} */ (s.nodeVar('server.env', 'T2F_EDGE_SECRET'));
    const n0 = s.worker.secrets.length;
    /** @type {{ secret: 'old' | 'new', line: string }[]} */
    const seen = [];
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        const fresh = s.worker.secrets.length > n0;
        const value = fresh ? s.worker.secrets[s.worker.secrets.length - 1] : old;
        const h = await s.health({ value });
        seen.push({ secret: fresh ? 'new' : 'old', line: h.stdout.split('\n')[0] ?? `exec ${h.code}` });
        await sleep(250);
      }
    })();
    let r;
    try {
      r = await s.ops(['edge-secret', '--env', ENV, '--rotate', '--target', 'local']);
    } finally {
      stop = true;
      await loop;
    }
    expect(r.code, r.text).toBe(0);
    console.log(`[p12-probe] ${seen.length} answers: ${[...new Set(seen.map((x) => `${x.secret}:${x.line.split(' ')[0]}`))].join(', ')}`);
    expect(seen.filter((x) => x.line.startsWith('404'))).toEqual([]);
    expect(seen.some((x) => x.secret === 'old' && x.line.startsWith('200'))).toBe(true);
    expect(seen.some((x) => x.secret === 'new' && x.line.startsWith('200'))).toBe(true);
    const gens = s.journal().filter((x) => x.kind === 'edge-secret').map((x) => /** @type {{ generation: number }} */ (x).generation);
    expect(gens).toEqual([2]);
    expect(s.nodeVar('server.env', 'T2F_EDGE_SECRET')).toBe(s.worker.secrets[s.worker.secrets.length - 1]);
    expect(s.nodeVar('server.env', 'T2F_EDGE_SECRET_PREVIOUS') ?? '').toBe('');
    expect(await s.healthLine()).toBe(`200 ${s.base}`);
  });
});
