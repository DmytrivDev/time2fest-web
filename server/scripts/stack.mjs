// @ts-check
/**
 * Local stack tool (SPEC-02 W20). Usage: node scripts/stack.mjs up|down|db-create|serve|start|smoke|all
 * Never runs `down -v` or removes volumes. Spawns without a shell; prints no secrets.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveWorktree } from './lib/worktree.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(serverDir, '..');
const composeFile = path.join(rootDir, 'docker-compose.yml');
const DOCKER_TIMEOUT_MS = 10_000;
const IS_WIN = process.platform === 'win32';

/** @param {string} step @param {number} t0 */
const ok = (step, t0) => console.log(`[stack] ${step} ok (${Date.now() - t0} ms)`);

/** @returns {Record<string, string>} */
function readEnvLocal() {
  const file = path.join(serverDir, '.env.local');
  /** @type {Record<string, string>} */
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] !== undefined) out[m[1]] = m[2] ?? '';
  }
  return out;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} [opts]
 */
function run(cmd, args, opts = { encoding: 'utf8' }) {
  return spawnSync(cmd, args, opts);
}

function up() {
  const t0 = Date.now();
  const info = run('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: DOCKER_TIMEOUT_MS });
  if (info.status !== 0) {
    const first = String(info.stderr || info.error?.message || 'no answer').split(/\r?\n/)[0];
    console.error(`Docker is not reachable (start Docker Desktop): ${first}`);
    process.exit(2);
  }
  const r = run(
    'docker',
    ['compose', '-p', 't2f', '-f', composeFile, 'up', '-d', '--wait', 'postgres', 'redis', 'centrifugo', 'mailpit', 'r2'],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  ok('up', t0);
}

function down() {
  const t0 = Date.now();
  const r = run('docker', ['compose', '-p', 't2f', '-f', composeFile, 'stop'], { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  ok('down', t0);
}

/** @param {string[]} args @param {string} step */
function nodeStep(args, step) {
  const t0 = Date.now();
  const r = run(process.execPath, args, { encoding: 'utf8', cwd: serverDir, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[stack] ${step} failed`);
    process.exit(r.status ?? 1);
  }
  ok(step, t0);
}

function dbCreate() {
  nodeStep([path.join('scripts', 'db.mjs'), 'create'], 'db-create');
  nodeStep([path.join('scripts', 'db.mjs'), 'env'], 'db-env');
}

/** @param {string} script @param {string} step */
function pnpmScript(script, step) {
  const t0 = Date.now();
  // pnpm is a .cmd shim on Windows; the argument is a fixed script name, never user input.
  const r = run('pnpm', [script], { encoding: 'utf8', cwd: serverDir, stdio: 'inherit', shell: IS_WIN });
  if (r.status !== 0) {
    console.error(`[stack] ${step} failed`);
    process.exit(r.status ?? 1);
  }
  ok(step, t0);
}

/** @param {number} port @param {string} host */
function probePort(port, host) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, host, () => s.close(() => resolve(undefined)));
  });
}

/** @param {'dev' | 'start'} mode @param {number} [t0] */
async function serve(mode, t0 = Date.now()) {
  const env = { ...readEnvLocal(), ...process.env };
  const wt = resolveWorktree(serverDir, env);
  const port = wt.ports.server;
  const cls = env.T2F_ENV ?? 'test';
  const host = cls === 'test' ? '127.0.0.1' : (env.T2F_HOST ?? '127.0.0.1');
  try {
    await probePort(port, host);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EADDRINUSE') {
      console.error(`port ${port} is in use`);
      process.exit(3);
    }
    throw e;
  }
  const pre = run('pnpm', ['env:check'], { encoding: 'utf8', cwd: serverDir, stdio: 'inherit', shell: IS_WIN });
  if (pre.status !== 0) {
    console.error('[stack] env:check failed, next not started');
    process.exit(1);
  }
  const nextBin = path.join(serverDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, mode === 'dev' ? 'dev' : 'start', '-p', String(port), '-H', host], {
    cwd: serverDir,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env },
  });
  let announced = false;
  child.stdout.on('data', (/** @type {Buffer} */ d) => {
    process.stdout.write(d);
    if (!announced && /Ready|started server|Local:/i.test(String(d))) {
      announced = true;
      console.log(`[stack] listening on http://${host}:${port} (${Date.now() - t0} ms)`);
    }
  });
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** @param {number} port @param {string} payload */
function redisPing(port, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('timeout'));
    }, 5000);
    sock.on('connect', () => sock.write(payload));
    sock.on('data', (d) => {
      clearTimeout(timer);
      sock.end();
      resolve(String(d));
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function smoke() {
  const env = { ...readEnvLocal(), ...process.env };
  const wt = resolveWorktree(serverDir, env);
  /** @type {Array<[string, () => Promise<void>]>} */
  const checks = [
    [
      'server /api/time',
      async () => {
        const res = await fetch(`http://127.0.0.1:${wt.ports.server}/api/time`);
        const body = /** @type {Record<string, unknown>} */ (await res.json());
        const keys = Object.keys(body);
        if (res.status !== 200 || keys.length !== 1 || keys[0] !== 'now' || !Number.isInteger(body.now)) {
          throw new Error('bad body');
        }
      },
    ],
    [
      'redis PING',
      async () => {
        const r = await redisPing(6380, '*1\r\n$4\r\nPING\r\n');
        if (!String(r).startsWith('+PONG')) throw new Error('no PONG');
      },
    ],
    [
      'postgres SELECT 1',
      async () => {
        const c = new pg.Client({ connectionString: 'postgres://t2f@127.0.0.1:5433/postgres' });
        await c.connect();
        try {
          await c.query('SELECT 1');
        } finally {
          await c.end();
        }
      },
    ],
    [
      'mailpit info',
      async () => {
        const r = await fetch('http://127.0.0.1:8025/api/v1/info');
        if (!r.ok) throw new Error(String(r.status));
      },
    ],
    [
      'centrifugo health',
      async () => {
        const r = await fetch('http://127.0.0.1:8000/health');
        if (!r.ok) throw new Error(String(r.status));
      },
    ],
    [
      'r2',
      async () => {
        const deadline = Date.now() + 30_000;
        for (;;) {
          try {
            const r = await fetch('http://127.0.0.1:9090/favicon.ico');
            if (r.status === 200) return;
            throw new Error(String(r.status));
          } catch (e) {
            if (Date.now() > deadline) throw e;
            await new Promise((res) => setTimeout(res, 1000));
          }
        }
      },
    ],
  ];
  /** @type {string[]} */
  const failed = [];
  for (const [name, fn] of checks) {
    try {
      await fn();
    } catch (e) {
      failed.push(`${name}: ${/** @type {Error} */ (e).message}`);
    }
  }
  if (failed.length === 0) {
    console.log(`smoke ${checks.length}/${checks.length}`);
  } else {
    console.error(`smoke ${checks.length - failed.length}/${checks.length}, failed: ${failed.join('; ')}`);
    process.exit(1);
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case 'up':
    up();
    break;
  case 'down':
    down();
    break;
  case 'db-create':
    dbCreate();
    break;
  case 'serve':
    await serve('dev');
    break;
  case 'start':
    await serve('start');
    break;
  case 'smoke':
    await smoke();
    break;
  case 'all': {
    const t0 = Date.now();
    up();
    dbCreate();
    pnpmScript('migrate', 'migrate');
    pnpmScript('seed', 'seed');
    await serve('dev', t0);
    break;
  }
  default:
    console.error('usage: stack.mjs up | down | db-create | serve | start | smoke | all');
    process.exit(2);
}
