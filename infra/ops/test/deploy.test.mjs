// @ts-check
// W20 — розгортання на фейках: порядок кроків у журналі (AC-9), брудне дерево (AC-11), міграції (AC-12),
// здоров’я (AC-13), Worker (AC-14), запис журналу (AC-15), диск (AC-18), без `down` (AC-19), без `secret put` (AC-20),
// prelaunch — лише Worker (AC-21), простій (AC-53), сторожові значення секретів (NFR-4).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorker } from '../lib/worker.mjs';
import { fakeCloudflare } from './support/fakeCloudflare.mjs';
import { main } from '../ops.mjs';
import {
  HOST,
  okRecord,
  scenario,
  SENTINEL_EDGE,
  SENTINEL_TOKEN,
  SHA_A,
  SHA_B,
  V_NEW,
  V_OLD,
} from './support/scenario.mjs';

const LOCAL = ['deploy', '--env', 'rehearsal', '--target', 'local'];
const REMOTE = ['deploy', '--env', 'rehearsal', '--target', HOST];
const SERVER_STEPS = ['build', 'deliver', 'migrate', 'swap', 'health', 'worker'];

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {Parameters<typeof scenario>[0]} [o] */
function world(o) {
  const sc = scenario(o);
  cleanups.push(sc.cleanup);
  return sc;
}

/** @param {ReturnType<typeof scenario>} sc */
const stepsOk = (sc) =>
  sc.journal().flatMap((r) => (r.kind === 'step' && r.status === 'ok' ? [r.step] : []));
/** @param {ReturnType<typeof scenario>} sc */
const outcomes = (sc) => sc.journal().filter((r) => r.kind === 'deploy');
/** @param {ReturnType<typeof scenario>} sc */
const swaps = (sc) => sc.fx.calls.filter((c) => c.argv.includes('--force-recreate'));

/** Жоден argv не запускає `down` чи `migrate:down` (AC-19), жоден виклик wrangler — не `secret put` (AC-20). @param {ReturnType<typeof scenario>} sc */
function assertNeverDownNorSecret(sc) {
  for (const c of sc.fx.calls) {
    expect(c.argv).not.toContain('down');
    expect(c.argv.join(' ')).not.toMatch(/migrate:down/);
  }
  expect(sc.wranglerCalls().some((c) => c.argv.includes('secret'))).toBe(false);
}

/** Сторожові значення ніде: ні в out/err, ні в журналі (NFR-4). @param {ReturnType<typeof scenario>} sc */
function assertNoSentinel(sc) {
  const all = [...sc.out, ...sc.err, sc.journalText()].join('\n');
  expect(all).not.toContain(SENTINEL_EDGE);
  expect(all).not.toContain(SENTINEL_TOKEN);
}

describe('deploy to the local node (rehearsal)', () => {
  it('runs build → deliver → migrate → swap → health → worker, journals every step and an ok record', async () => {
    const sc = world({ running: SHA_A, images: [SHA_A] });
    sc.seedJournal([okRecord({ commit: SHA_A, imageBefore: null, imageAfter: `t2f-server:${SHA_A}` })]);
    expect(await main(LOCAL, sc.deps())).toBe(0);

    expect(stepsOk(sc)).toEqual(SERVER_STEPS);
    const steps = sc.journal().filter((r) => r.kind === 'step');
    expect(steps.map((r) => (r.kind === 'step' ? `${r.step}:${r.status}` : ''))).toEqual(
      SERVER_STEPS.flatMap((s) => [`${s}:start`, `${s}:ok`]),
    );
    const rec = outcomes(sc).at(-1);
    expect(rec).toEqual({
      kind: 'deploy',
      at: '2026-11-17T10:00:00.000Z',
      env: 'rehearsal',
      commit: SHA_B,
      imageBefore: `t2f-server:${SHA_A}`,
      imageAfter: `t2f-server:${SHA_B}`,
      workerVersionBefore: V_OLD,
      workerVersionAfter: V_NEW,
      edgeSecretGeneration: 1,
      result: 'ok',
      failedStep: null,
    });
    // Сервер працює з нового образу, `current.env` указує на нього; Worker розгорнуто після здоров’я.
    expect(sc.st.running).toBe(SHA_B);
    expect(sc.readAt(sc.nodeFile('current.env'))).toBe(`T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA_B}\n`);
    const order = sc.fx.calls.map((c) => c.argv.join(' '));
    const iHealth = order.map((a) => a.includes('health-probe')).lastIndexOf(true);
    const iBuild = order.findIndex((a) => /[\\/]next build$/.test(a));
    const iDeploy = order.findIndex((a) => /wrangler\.js deploy --env rehearsal$/.test(a));
    expect(iHealth).toBeLessThan(iBuild);
    expect(iBuild).toBeLessThan(iDeploy);
    assertNeverDownNorSecret(sc);
    assertNoSentinel(sc);
  });

  it('builds the image from the commit archive (stdin), with the full SHA tag', async () => {
    const sc = world();
    expect(await main(LOCAL, sc.deps())).toBe(0);
    const build = sc.fx.calls.find((c) => c.argv[1] === 'build');
    expect(build?.argv).toEqual(['docker', 'build', '-f', 'server/Dockerfile', '--build-arg', `T2F_COMMIT=${SHA_B}`, '-t', `t2f-server:${SHA_B}`, '-']);
    expect(build?.inputLength).toBeGreaterThan(0);
    expect(sc.fx.calls.filter((c) => c.transport === 'start').map((c) => c.argv.slice(0, 2))).toEqual([['git', 'archive']]);
  });

  it('a dirty tree refuses before the build (AC-11): code 2, 0 docker, 0 wrangler, empty journal', async () => {
    const sc = world();
    sc.st.dirty = true;
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('незакомічені зміни');
    expect(sc.dockerCalls()).toEqual([]);
    expect(sc.wranglerCalls()).toEqual([]);
    expect(sc.journal()).toEqual([]);
  });

  it('a failed migration keeps the previous container (AC-12): 0 swaps, 0 wrangler deploy, failedStep migrate, «міграції»', async () => {
    const sc = world({ running: SHA_A, images: [SHA_A] });
    sc.st.migrateCode = 1;
    expect(await main(LOCAL, sc.deps())).toBe(1);
    expect(swaps(sc)).toEqual([]);
    expect(sc.wranglerCalls().filter((c) => !c.argv.includes('status'))).toEqual([]);
    expect(sc.st.running).toBe(SHA_A);
    expect(sc.err.join('\n')).toContain('міграції');
    expect(outcomes(sc).at(-1)).toMatchObject({ result: 'failed', failedStep: 'migrate', imageAfter: `t2f-server:${SHA_A}` });
    expect(sc.readAt(sc.nodeFile('current.env'))).toContain(SHA_A);
    assertNoSentinel(sc); // stderr міграції містив сторожове значення
  });

  it('no 200 within 60 s → swap back to the previous image, 0 wrangler deploy, failedStep health (AC-13)', async () => {
    const sc = world({ running: SHA_A, images: [SHA_A] });
    sc.st.healthy = (sha) => sha === SHA_A;
    expect(await main(LOCAL, sc.deps())).toBe(1);
    const s = swaps(sc);
    expect(s).toHaveLength(2);
    expect(s[0].argv).toContain(sc.nodeFile('next.env'));
    expect(s[1].argv).toContain(sc.nodeFile('current.env'));
    expect(sc.st.running).toBe(SHA_A);
    expect(sc.wranglerCalls().filter((c) => !c.argv.includes('status'))).toEqual([]);
    expect(sc.clock.t).toBeGreaterThanOrEqual(59_000);
    expect(sc.clock.t).toBeLessThanOrEqual(90_000);
    expect(outcomes(sc).at(-1)).toMatchObject({ result: 'failed', failedStep: 'health', imageAfter: `t2f-server:${SHA_A}` });
    expect(stepsOk(sc)).toEqual(['build', 'deliver', 'migrate', 'swap', 'swap-back']);
    expect(sc.readAt(sc.nodeFile('current.env'))).toContain(SHA_A);
  });

  it('a Worker failure keeps the new server (AC-14): worker-failed, no swap back, «Worker»', async () => {
    const sc = world({ running: SHA_A, images: [SHA_A] });
    sc.st.wrangler.deploy = 1;
    expect(await main(LOCAL, sc.deps())).toBe(1);
    expect(swaps(sc)).toHaveLength(1);
    expect(sc.st.running).toBe(SHA_B);
    expect(sc.readAt(sc.nodeFile('current.env'))).toContain(SHA_B);
    expect(sc.err.join('\n')).toContain('Worker');
    expect(outcomes(sc).at(-1)).toMatchObject({ result: 'worker-failed', failedStep: 'worker', imageAfter: `t2f-server:${SHA_B}`, workerVersionAfter: V_OLD });
    assertNoSentinel(sc); // stderr wrangler містив сторожовий токен
  });

  it('keeps the three latest images plus current and previous (AC-16)', async () => {
    const shas = ['1', '2', '3', '4'].map((c) => c.repeat(40));
    const sc = world({ running: shas[3], images: shas });
    sc.seedJournal(shas.map((s, i) => okRecord({ commit: s, imageBefore: i ? `t2f-server:${shas[i - 1]}` : null, imageAfter: `t2f-server:${s}` })));
    expect(await main(LOCAL, sc.deps())).toBe(0);
    expect([...sc.st.localImages].sort()).toEqual([shas[2], shas[3], SHA_B].sort());
  });

  it('--probe through a local check records downtimeSeconds', async () => {
    const sc = world({ running: SHA_A, images: [SHA_A] });
    /** @type {unknown[]} */
    const started = [];
    const startProbe = (/** @type {object} */ o) => {
      started.push(o);
      return { stop: () => ({ downtimeSeconds: 3, samples: 10, failures: 3 }) };
    };
    expect(await main([...LOCAL, '--probe'], sc.deps({ startProbe }))).toBe(0);
    expect(started).toHaveLength(1);
    expect(typeof /** @type {{ check?: unknown }} */ (started[0]).check).toBe('function');
    expect(outcomes(sc).at(-1)).toMatchObject({ result: 'ok', downtimeSeconds: 3 });
  });

  it('a second deploy while the lock is held refuses at once (code 2, nothing changed)', async () => {
    const sc = world();
    fs.mkdirSync(path.join(sc.stateRoot, 'node-local-rehearsal', 'deploy.lock'), { recursive: true });
    fs.writeFileSync(path.join(sc.stateRoot, 'node-local-rehearsal', 'deploy.lock', 'owner.json'), JSON.stringify({ pid: process.pid, at: '2026-11-17T09:00:00.000Z' }));
    expect(await main(LOCAL, sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('замок deploy-rehearsal зайнятий');
    expect(sc.dockerCalls()).toEqual([]);
  });

  it('missing Cloudflare credentials refuse before any change', async () => {
    const sc = world();
    const deps = sc.deps();
    expect(await main(LOCAL, { ...deps, env: {} })).toBe(2);
    expect(sc.err.join('\n')).toContain('CLOUDFLARE_API_TOKEN');
    expect(sc.dockerCalls()).toEqual([]);
  });
});

describe('deploy to a remote node over ssh', () => {
  it('runs every step through the ssh transport with the remote lock, journal and compose paths', async () => {
    const sc = world({ target: HOST, running: SHA_A, nodeImages: [SHA_A] });
    expect(await main(REMOTE, sc.deps())).toBe(0);
    expect(stepsOk(sc)).toEqual(SERVER_STEPS);
    const ssh = sc.fx.callsOf(`ssh:${HOST}`).map((c) => c.argv.join(' '));
    expect(ssh[0]).toBe("flock -n -E 75 /srv/t2f/rehearsal/deploy.lock sh -c echo locked; exec cat");
    expect(ssh).toContain('df -Pk /var/lib/docker');
    expect(ssh).toContain('docker load');
    expect(ssh).toContain('docker compose -p t2f-rehearsal -f /srv/t2f/rehearsal/compose.yml --env-file /srv/t2f/rehearsal/next.env run --rm --no-deps server pnpm migrate');
    // Збірка — на машині оператора, доставка — `docker save` локально.
    expect(sc.fx.callsOf('local').some((c) => c.argv[1] === 'build')).toBe(true);
    expect(sc.fx.calls.filter((c) => c.transport === 'start').map((c) => c.argv.slice(0, 2).join(' '))).toEqual(['git archive', 'docker save']);
    expect(sc.remoteFiles.get('/srv/t2f/rehearsal/current.env')).toBe(`T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA_B}\n`);
    expect(sc.remoteFiles.get('/srv/t2f/rehearsal/compose.yml')).toContain('postgres:');
    expect(outcomes(sc).at(-1)).toMatchObject({ result: 'ok', imageBefore: `t2f-server:${SHA_A}` });
    assertNeverDownNorSecret(sc);
    assertNoSentinel(sc);
  });

  it('--probe through the edge uses the https health URL of the site', async () => {
    const sc = world({ target: HOST, running: SHA_A, nodeImages: [SHA_A] });
    /** @type {unknown[]} */
    const started = [];
    const startProbe = (/** @type {object} */ o) => {
      started.push(o);
      return { stop: () => ({ downtimeSeconds: 0, samples: 5, failures: 0 }) };
    };
    expect(await main([...REMOTE, '--probe'], sc.deps({ startProbe }))).toBe(0);
    expect(started).toEqual([{ url: 'https://rehearsal.time2fest.com/api/health' }]);
    expect(outcomes(sc).at(-1)).toMatchObject({ downtimeSeconds: 0 });
  });

  it('a server env without --target refuses (code 2, 0 calls beyond git)', async () => {
    const sc = world();
    expect(await main(['deploy', '--env', 'rehearsal'], sc.deps())).toBe(2);
    expect(sc.err.join('\n')).toContain('--target');
    expect(sc.dockerCalls()).toEqual([]);
  });
});

describe('prelaunch (AC-21)', () => {
  it('with both flags runs only the worker step: 0 docker, 0 ssh, 0 next build', async () => {
    const sc = world();
    const assets = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-pre-'));
    cleanups.push(() => fs.rmSync(assets, { recursive: true, force: true }));
    fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html>');
    const deps = sc.deps();
    const worker = createWorker({ env: 'prelaunch', processEnv: deps.env, run: sc.exec.run, assetsDir: assets });
    const cf = fakeCloudflare();
    const env = { ...deps.env, CLOUDFLARE_ZONE_ID: 'zone1' };
    expect(await main(['deploy', '--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain'], { ...deps, env, fetch: cf.fetch, worker: () => worker })).toBe(0);
    expect(cf.calls.map((c) => c.url.replace(/^.*\/client\/v4/, ''))).toEqual([
      '/zones/zone1/workers/routes',
      '/accounts/account-id/workers/domains?hostname=time2fest.com',
      '/zones/zone1/dns_records?name=time2fest.com&per_page=100',
    ]);
    expect(sc.dockerCalls()).toEqual([]);
    expect(sc.fx.calls.filter((c) => c.transport.startsWith('ssh:'))).toEqual([]);
    expect(sc.fx.calls.some((c) => c.argv.includes('build'))).toBe(false);
    expect(sc.wranglerCalls().map((c) => c.argv.slice(2).join(' '))).toEqual([
      'deployments status --json --env prelaunch',
      'deploy --env prelaunch',
      'deployments status --json --env prelaunch',
    ]);
    const journal = fs.readFileSync(path.join(sc.stateRoot, 'edge-prelaunch', 'journal.jsonl'), 'utf8');
    expect(journal).toContain('"step":"worker"');
    expect(journal).toContain('"result":"ok"');
    expect(journal).not.toContain('"step":"build"');
  });

  it('empty prelaunch assets refuse before any change', async () => {
    const sc = world();
    const assets = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-pre-'));
    cleanups.push(() => fs.rmSync(assets, { recursive: true, force: true }));
    const deps = sc.deps();
    const worker = createWorker({ env: 'prelaunch', processEnv: deps.env, run: sc.exec.run, assetsDir: assets });
    expect(await main(['deploy', '--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain'], { ...deps, worker: () => worker })).toBe(2);
    expect(sc.wranglerCalls()).toEqual([]);
  });

  /** @param {Parameters<typeof fakeCloudflare>[0]} cfo @param {string[]} [extra] @param {Record<string, string>} [envExtra] */
  async function prelaunchWith(cfo, extra = [], envExtra = { CLOUDFLARE_ZONE_ID: 'zone1' }) {
    const sc = world();
    const assets = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-pre-'));
    cleanups.push(() => fs.rmSync(assets, { recursive: true, force: true }));
    fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html>');
    const deps = sc.deps();
    const worker = createWorker({ env: 'prelaunch', processEnv: deps.env, run: sc.exec.run, assetsDir: assets });
    const cf = fakeCloudflare(cfo);
    const code = await main(['deploy', '--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain', ...extra], {
      ...deps,
      env: { ...deps.env, ...envExtra },
      fetch: cf.fetch,
      worker: () => worker,
    });
    return { code, sc, cf };
  }

  it('F1: the main name held by another Worker → 2 before any wrangler call', async () => {
    const r = await prelaunchWith({ bindings: [{ id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-production' }] });
    expect(r.code).toBe(2);
    expect(r.sc.wranglerCalls()).toEqual([]);
    expect(r.sc.err.join('\n')).toContain('t2f-edge-production');
  });

  it('F1: the old site’s apex A record → 2; with --take-domain-from dns → deployed', async () => {
    const records = [{ name: 'time2fest.com', type: 'A', content: '203.0.113.50', meta: {} }];
    const refused = await prelaunchWith({ records });
    expect(refused.code).toBe(2);
    expect(refused.sc.wranglerCalls()).toEqual([]);
    const taken = await prelaunchWith({ records }, ['--take-domain-from', 'dns']);
    expect(taken.code).toBe(0);
    expect(taken.sc.wranglerCalls().map((c) => c.argv.slice(2).join(' '))).toContain('deploy --env prelaunch');
  });

  it('F1: no CLOUDFLARE_ZONE_ID or no DNS-read right → 2 naming what is missing, 0 wrangler', async () => {
    const noZone = await prelaunchWith({}, [], {});
    expect(noZone.code).toBe(2);
    expect(noZone.sc.err.join('\n')).toContain('CLOUDFLARE_ZONE_ID');
    expect(noZone.cf.calls).toEqual([]);
    expect(noZone.sc.wranglerCalls()).toEqual([]);
    const noRight = await prelaunchWith({ recordsStatus: 403 });
    expect(noRight.code).toBe(2);
    expect(noRight.sc.err.join('\n')).toContain('DNS → Read');
    expect(noRight.sc.wranglerCalls()).toEqual([]);
  });
});

describe('--secrets-file', () => {
  it('credentials come from the file; its secret values never reach the output', async () => {
    const sc = world();
    const file = path.join(sc.stateRoot, 'secrets.env');
    fs.writeFileSync(file, `CLOUDFLARE_API_TOKEN=${SENTINEL_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=acc\nT2F_EDGE_SECRET=${SENTINEL_EDGE}\n`);
    const deps = sc.deps();
    expect(await main([...LOCAL, '--secrets-file', file], { ...deps, env: {} })).toBe(0);
    assertNoSentinel(sc);
  });

  it('an unreadable secrets file refuses with code 2 without naming its content', async () => {
    const sc = world();
    expect(await main([...LOCAL, '--secrets-file', path.join(sc.stateRoot, 'missing.env')], sc.deps())).toBe(2);
    expect(sc.dockerCalls()).toEqual([]);
  });
});
