// @ts-check
// W19 — Worker: argv кожного виклику wrangler, розбір `deployments status --json`, значення секрету лише на stdin,
// змінні збірки сайту = прапорці `build:edge:rehearsal`, deploy/rollback не імпортують `putSecret` (AC-20).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../lib/exec.mjs';
import { createWorker, EDGE_DIR, NEXT_JS, parseDeploymentStatus, siteBuildEnv, WRANGLER_JS } from '../lib/worker.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const FIXTURE = fs.readFileSync(new URL('./fixtures/deployments-status.json', import.meta.url), 'utf8');
const FIXTURE_VERSION = '1f0c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
const SECRET = 'sentinel-worker-secret-00112233445566778899'; // check-secrets: allow
const ENV = { CLOUDFLARE_API_TOKEN: 'token-for-tests-only-abcdef', CLOUDFLARE_ACCOUNT_ID: 'acc' }; // check-secrets: allow

/**
 * Фейковий runner, що запам’ятовує й опції (cwd, env, input) — fakeExec записує лише argv і довжину входу.
 * @param {import('./support/fakeExec.mjs').Script[]} [script]
 */
function recorder(script = []) {
  const fx = createFakeExec(script);
  /** @type {{ argv: string[], opts: import('../lib/exec.mjs').RunOpts }[]} */
  const seen = [];
  /** @type {import('../lib/worker.mjs').Runner} */
  const run = (file, args, opts = {}) => {
    seen.push({ argv: [file, ...args], opts });
    return fx.run(file, args, opts);
  };
  return { fx, run, seen };
}

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('deployments status', () => {
  it('parses versions[0].version_id from the fixture, also with noise around the JSON', () => {
    expect(parseDeploymentStatus(FIXTURE)).toBe(FIXTURE_VERSION);
    expect(parseDeploymentStatus(`warning line\n${FIXTURE}\n`)).toBe(FIXTURE_VERSION);
    expect(parseDeploymentStatus('{"versions":[]}')).toBeNull();
    expect(parseDeploymentStatus('{"versions":[{"version_id":"not-a-uuid"}]}')).toBeNull();
    expect(parseDeploymentStatus('not json')).toBeNull();
  });

  it('currentVersion runs `node wrangler.js deployments status --json --env rehearsal` in workers/edge', async () => {
    const { run, seen } = recorder([{ match: () => true, result: { stdout: FIXTURE } }]);
    const w = createWorker({ env: 'rehearsal', processEnv: ENV, run });
    expect(await w.currentVersion()).toEqual({ code: 0, version: FIXTURE_VERSION });
    expect(seen[0].argv).toEqual([process.execPath, WRANGLER_JS, 'deployments', 'status', '--json', '--env', 'rehearsal']);
    expect(seen[0].opts.cwd).toBe(EDGE_DIR);
    expect(seen[0].opts.env?.CLOUDFLARE_API_TOKEN).toBe(ENV.CLOUDFLARE_API_TOKEN);
  });

  it('a Worker that does not exist yet → version null; any other failure → code 1', async () => {
    const missing = recorder([{ match: () => true, result: { code: 1, stderr: 'The Worker t2f-edge-rehearsal has no deployments.' } }]);
    expect(await createWorker({ env: 'rehearsal', processEnv: ENV, run: missing.run }).currentVersion()).toEqual({ code: 0, version: null });
    const broken = recorder([{ match: () => true, result: { code: 1, stderr: 'Authentication error [code: 10000]' } }]);
    expect((await createWorker({ env: 'rehearsal', processEnv: ENV, run: broken.run }).currentVersion()).code).toBe(1);
  });
});

describe('deploy, rollback, secret', () => {
  it('deploy → `deploy --env <workerEnv>` then the new version', async () => {
    const { run, seen } = recorder([{ match: (c) => c.argv.includes('status'), result: { stdout: FIXTURE } }]);
    const w = createWorker({ env: 'prelaunch', processEnv: ENV, run });
    expect(await w.deploy()).toEqual({ code: 0, version: FIXTURE_VERSION });
    expect(seen.map((s) => s.argv.slice(2))).toEqual([
      ['deploy', '--env', 'prelaunch'],
      ['deployments', 'status', '--json', '--env', 'prelaunch'],
    ]);
  });

  it('a failing wrangler deploy is a step failure', async () => {
    const { run } = recorder([{ match: () => true, result: { code: 1 } }]);
    expect((await createWorker({ env: 'rehearsal', processEnv: ENV, run }).deploy()).code).toBe(1);
  });

  it('rollback → `rollback <id> -m "t2f rollback" -y --env rehearsal`; a non-UUID never reaches wrangler', async () => {
    const { run, seen } = recorder();
    const w = createWorker({ env: 'rehearsal', processEnv: ENV, run });
    expect(await w.rollback(FIXTURE_VERSION)).toEqual({ code: 0 });
    expect(seen[0].argv.slice(2)).toEqual(['rollback', FIXTURE_VERSION, '-m', 't2f rollback', '-y', '--env', 'rehearsal']);
    expect((await w.rollback('x; rm -rf /')).code).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('putSecret passes the value only on stdin — never in argv or env', async () => {
    const { run, seen, fx } = recorder();
    const w = createWorker({ env: 'rehearsal', processEnv: ENV, run });
    expect(await w.putSecret('T2F_EDGE_SECRET', SECRET)).toEqual({ code: 0 });
    expect(seen[0].argv.slice(2)).toEqual(['secret', 'put', 'T2F_EDGE_SECRET', '--env', 'rehearsal']);
    expect(seen[0].opts.input).toBe(`${SECRET}\n`);
    expect(fx.calls[0].inputLength).toBe(SECRET.length + 1);
    expect(JSON.stringify(seen[0].argv)).not.toContain(SECRET);
    expect(Object.values(seen[0].opts.env ?? {})).not.toContain(SECRET);
    expect((await w.putSecret('bad name', SECRET)).code).toBe(1);
    expect((await w.putSecret('T2F_EDGE_SECRET', 'two\nlines')).code).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('deploy.mjs and rollback.mjs never use putSecret (AC-20)', () => {
    for (const f of ['deploy.mjs', 'rollback.mjs']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'infra', 'ops', 'lib', f), 'utf8');
      expect(src).not.toMatch(/putSecret|secret['"]?\s*,\s*['"]put/);
    }
  });
});

describe('site build (AC-31)', () => {
  it('rehearsal builds test+http into out-edge-rehearsal — the same flags as the build:edge:rehearsal script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const script = String(pkg.scripts['build:edge:rehearsal']);
    const flags = Object.fromEntries([...script.matchAll(/\b([A-Z_]+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    expect(script).toMatch(/next build$/);
    expect(siteBuildEnv('rehearsal')).toEqual(flags);
    expect(flags).toEqual({ NEXT_PUBLIC_ENV: 'test', NEXT_PUBLIC_API_MODE: 'http', NEXT_DIST_DIR: 'out-edge-rehearsal' });
    expect(siteBuildEnv('prelaunch')).toBeNull();
  });

  it('buildSite runs next build from the repo root with those flags and T2F_CATALOG_URL', async () => {
    const { run, seen } = recorder();
    const w = createWorker({ env: 'rehearsal', processEnv: ENV, run });
    expect(await w.buildSite()).toEqual({ code: 0 });
    expect(seen[0].argv).toEqual([process.execPath, NEXT_JS, 'build']);
    expect(seen[0].opts.cwd).toBe(REPO_ROOT);
    expect(seen[0].opts.env).toMatchObject({
      NEXT_PUBLIC_ENV: 'test',
      NEXT_PUBLIC_API_MODE: 'http',
      NEXT_DIST_DIR: 'out-edge-rehearsal',
      T2F_CATALOG_URL: 'https://rehearsal.time2fest.com',
    });
    const own = recorder();
    await createWorker({ env: 'rehearsal', processEnv: { ...ENV, T2F_CATALOG_URL: 'http://127.0.0.1:4260' }, run: own.run }).buildSite();
    expect(own.seen[0].opts.env?.T2F_CATALOG_URL).toBe('http://127.0.0.1:4260');
  });

  it('prelaunch has no build; its assets must exist and be non-empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-assets-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const w = createWorker({ env: 'prelaunch', processEnv: ENV, assetsDir: dir });
    expect(w.hasBuild()).toBe(false);
    expect(w.assetsReady()).toBe(false);
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    expect(w.assetsReady()).toBe(true);
    expect(createWorker({ env: 'prelaunch', processEnv: ENV, assetsDir: path.join(dir, 'missing') }).assetsReady()).toBe(false);
  });

  it('missing Cloudflare credentials are named', () => {
    expect(createWorker({ env: 'rehearsal', processEnv: {} }).missingCredentials()).toEqual(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
  });
});
