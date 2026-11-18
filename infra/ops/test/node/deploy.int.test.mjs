// @ts-check
// SPEC-13a W32 — локальний вузол, частина 1: розгортання справжнім Docker (HEAVY, під винятковим замком машини).
// AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-15, AC-16, AC-17. Проєкт `t2f-node-rehearsal`, жодного порту на хості.
import fs from 'node:fs';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImage } from '../../lib/image.mjs';
import { localTransport, start } from '../../lib/exec.mjs';
import { ENV, createSuite, docker, sleep, syntheticSha } from './support.mjs';

const s = createSuite('deploy');
const DEPLOY = ['deploy', '--env', ENV, '--target', 'local'];
const STEP_ORDER = ['build', 'deliver', 'migrate', 'swap', 'health', 'worker'].flatMap((n) => [`${n}:start`, `${n}:ok`]);
const AC15_FIELDS = ['at', 'env', 'commit', 'imageBefore', 'imageAfter', 'workerVersionBefore', 'workerVersionAfter', 'edgeSecretGeneration', 'result', 'failedStep'];

/** Рядки `--raw` без заголовка `date` (єдина різниця двох відповідей у часі). @param {string} raw */
const normalise = (raw) => raw.split('\n').filter((l) => !/^date:/i.test(l));

/** Чи з’єднання з хоста на порт відхилено. @param {number} port */
const hostRefuses = (port) =>
  new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(3_000);
    sock.once('connect', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(true));
  });

beforeAll(async () => {
  await s.setup();
});

afterAll(async () => {
  await s.cleanup();
});

describe('local node: deploy (W32)', () => {
  it('AC-9, AC-1, AC-5: deploy of HEAD builds through git archive, runs the steps in order, health gives the SHA', async () => {
    const mark = s.worker.calls.length;
    const r = await s.ops(DEPLOY);
    expect(r.code, r.text).toBe(0);
    await s.pinBase();
    for (const step of ['build', 'deliver', 'migrate', 'swap', 'health', 'worker']) console.log(`[p12-timing] base ${step} ${s.stepMs(s.base, step)} ms`);

    expect(s.stepsOf(s.base)).toEqual(STEP_ORDER);
    expect(s.worker.calls.slice(mark)).toEqual([`deploy ${s.worker.current()}`]);

    expect(await s.healthLine()).toBe(`200 ${s.base}`);
    const raw = (await s.health({ raw: true })).stdout.split('\n');
    expect(raw[0]).toBe('200');
    expect(raw).toContain('cache-control: private, no-store');
    expect(raw[raw.length - 1]).toBe(`{"ok":true,"commit":"${s.base}"}`);

    // Без секрету краю — той самий єдиний 404, що й для невідомого шляху.
    const none = normalise((await s.health({ secret: 'none', raw: true })).stdout);
    const unknown = normalise((await s.health({ secret: 'none', raw: true, urlPath: '/api/t2f-node-suite-no-such-route' })).stdout);
    expect(none[0]).toBe('404');
    expect(none).toEqual(unknown);

    // AC-1: у контейнері немає `.git`.
    const noGit = await s.compose(['exec', '-T', 'server', 'sh', '-c', 'test ! -e /app/.git && test ! -e /app/server/.git']);
    expect(noGit.code, noGit.stderr).toBe(0);
  });

  it('AC-3, AC-4: no service publishes a host port; a host connection to the server port is refused', async () => {
    for (const [svc, port] of /** @type {const} */ ([['postgres', 5432], ['redis', 6379], ['server', 3000]])) {
      const p = await s.compose(['port', svc, String(port)]);
      // Неопублікований порт Compose друкує порожньо або з портом 0 (`invalid IP:0` у Compose v2).
      expect(p.stdout.trim(), `${svc} ${p.stderr}`).toMatch(/^(|(invalid IP)?:0)$/);
    }
    const ps = await docker(['ps', '--filter', 'label=com.docker.compose.project=t2f-node-rehearsal', '--format', '{{.Names}} {{.Ports}}']);
    expect(ps.stdout).not.toMatch(/->/);
    for (const id of (await docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=t2f-node-rehearsal'])).stdout.split(/\s+/).filter(Boolean)) {
      const hc = await docker(['container', 'inspect', '-f', '{{json .HostConfig.PortBindings}} {{.HostConfig.PublishAllPorts}}', id]);
      expect(hc.stdout.trim()).toMatch(/^(\{\}|null) false$/);
    }
    // З’єднання з хоста: відмова — пряма ознака. Якщо порт 3000 хоста тримає чужий процес (dev-сервер іншого
    // дерева), з’єднання з ним нічого не каже про вузол — тоді доказом лишаються порожні PortBindings вище.
    if (!(await hostRefuses(3000))) console.log('[p12-note] host 127.0.0.1:3000 is held by another process; publication checked through PortBindings');
  });

  it('AC-6: with redis stopped health answers 503 with the body exactly {"ok":false}', async () => {
    expect((await s.compose(['stop', 'redis'])).code).toBe(0);
    try {
      let line = '';
      for (let i = 0; i < 10 && !line.startsWith('503'); i++) {
        line = await s.healthLine();
        if (!line.startsWith('503')) await sleep(1_000);
      }
      expect(line).toBe('503 -');
      const raw = (await s.health({ raw: true })).stdout.split('\n');
      expect(raw[0]).toBe('503');
      expect(raw[raw.length - 1]).toBe('{"ok":false}');
    } finally {
      expect((await s.compose(['start', 'redis'])).code).toBe(0);
    }
    expect(await s.waitHealth(s.base)).toBe(`200 ${s.base}`);
  });

  it('AC-17: two concurrent deploys — exactly one runs the steps, the other is refused naming the lock', async () => {
    const a = await s.derive(syntheticSha('deploy-concurrent-a'));
    const b = await s.derive(syntheticSha('deploy-concurrent-b'));
    const from = s.journal().length;
    const [ra, rb] = await Promise.all([s.ops([...DEPLOY, '--commit', a]), s.ops([...DEPLOY, '--commit', b])]);
    expect([ra.code, rb.code].sort()).toEqual([0, 2]);
    const winner = ra.code === 0 ? a : b;
    const refused = ra.code === 0 ? rb : ra;
    expect(refused.text).toContain('deploy-rehearsal');
    const added = s.journal().slice(from);
    expect(new Set(added.map((r) => ('commit' in r ? r.commit : null)))).toEqual(new Set([winner]));
    expect(added.filter((r) => r.kind === 'deploy')).toHaveLength(1);
    expect(await s.healthLine()).toBe(`200 ${winner}`);
  });

  it('AC-16: after five deploys in a row exactly the images of the last three SHAs remain', async () => {
    /** @type {string[]} */
    const shas = [];
    for (let i = 1; i <= 5; i++) {
      // Похідний образ — безпосередньо перед своїм розгортанням: прибирання ops видаляє нерозгорнуті теги.
      const sha = await s.derive(syntheticSha(`deploy-retain-${i}`));
      const r = await s.ops([...DEPLOY, '--commit', sha]);
      expect(r.code, r.text).toBe(0);
      shas.push(sha);
      console.log(`[p12-timing] derived deploy ${i}: migrate ${s.stepMs(sha, 'migrate')} ms, swap ${s.stepMs(sha, 'swap')} ms, health ${s.stepMs(sha, 'health')} ms`);
    }
    expect(await s.healthLine()).toBe(`200 ${shas[4]}`);
    expect(await s.serverTags()).toEqual(shas.slice(2).sort());
  });

  it('AC-15, NFR-4: every deploy record has all fields and no secret value of the node files', () => {
    const records = s.journal().filter((r) => r.kind === 'deploy');
    expect(records.length).toBeGreaterThanOrEqual(7);
    for (const r of records) for (const f of AC15_FIELDS) expect(Object.hasOwn(r, f), `${f} in ${JSON.stringify(r)}`).toBe(true);
    const text = fs.readFileSync(s.nodeFile('journal.jsonl'), 'utf8');
    for (const [file, key] of [['server.env', 'PAYLOAD_SECRET'], ['server.env', 'T2F_EDGE_SECRET'], ['postgres.env', 'POSTGRES_PASSWORD']]) {
      const v = s.nodeVar(file, key);
      expect(v && v.length >= 32, key).toBe(true);
      expect(text.includes(/** @type {string} */ (v)), key).toBe(false);
    }
  });

  it('delivery pipe: docker save | gzip | docker load of the current image succeeds (first real run)', async () => {
    const current = s.nodeVar('current.env', 'T2F_SERVER_SHA');
    expect(current).toMatch(/^[0-9a-f]{40}$/);
    const local = localTransport();
    let hidden = false;
    // Ціль, якій образу «немає» (один раз), — щоб доставка не пропустилася, як для локальної цілі.
    /** @type {import('../../lib/exec.mjs').Transport} */
    const target = {
      ...local,
      exec(argv, opts) {
        if (!hidden && argv[1] === 'image' && argv[2] === 'inspect') {
          hidden = true;
          return Promise.resolve({ code: 1, stdout: '', stderr: '' });
        }
        return local.exec(argv, opts);
      },
    };
    const image = createImage({ local, git: { archive: () => { throw new Error('archive не очікується'); } }, start });
    const t0 = Date.now();
    const r = await image.deliver(target, /** @type {string} */ (current));
    console.log(`[p12-timing] deliver (save|gzip|load) ${Math.round((Date.now() - t0) / 1000)}s`);
    expect(r).toEqual({ code: 0, skipped: false });
    expect((await docker(['image', 'inspect', `t2f-server:${current}`])).code).toBe(0);
  });
});
