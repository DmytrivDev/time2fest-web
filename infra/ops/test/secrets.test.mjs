// @ts-check
// W22 — генерація секретів репетиції на фейках (AC-38, NFR-4): CSPRNG ≥ 32 байти, лише порожні значення,
// `.local` 0600 (POSIX) або git-ignored (Windows), надсилання файлів лише через stdin, секрет Worker’а — stdin.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { getVar, REDIS_URL_BASE, redisUrl } from '../lib/secrets/envFile.mjs';
import { NODE_ENV_FILES, PUSH_SCRIPT, WORKER_PENDING } from '../lib/secrets/files.mjs';
import { HOST, scenario } from './support/scenario.mjs';

const TUNNEL = 'tunnel-token-sentinel-0123456789abcdefABCDEF'; // check-secrets: allow fake sentinel (NFR-4 test)
const OWNER_R2 = 'owner-r2-secret-sentinel-9876543210zyxw'; // check-secrets: allow fake sentinel (NFR-4 test)
const GENERATED = ['PAYLOAD_SECRET', 'T2F_EDGE_SECRET'];
const GEN = ['edge-secret', '--env', 'rehearsal', '--generate'];

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {Parameters<typeof scenario>[0]} [o] */
function world(o = {}) {
  const sc = scenario(o);
  cleanups.push(sc.cleanup);
  const examplesDir = path.join(sc.stateRoot, 'examples');
  fs.mkdirSync(examplesDir, { recursive: true });
  const header = '# names only; values in .local/node\n';
  fs.writeFileSync(
    path.join(examplesDir, 'server.env.example'),
    `${header}DATABASE_URI=\nREDIS_URL=\nPAYLOAD_SECRET=\nT2F_EDGE_SECRET=\nT2F_EDGE_SECRET_PREVIOUS=\nT2F_REDIS_PREFIX=\nT2F_R2_SECRET_ACCESS_KEY=\n`,
  );
  fs.writeFileSync(path.join(examplesDir, 'postgres.env.example'), `${header}POSTGRES_USER=\nPOSTGRES_DB=\nPOSTGRES_PASSWORD=\n`);
  fs.writeFileSync(path.join(examplesDir, 'redis.env.example'), `${header}REDIS_PASSWORD=\n`);
  fs.writeFileSync(path.join(examplesDir, 'cloudflared.env.example'), `${header}TUNNEL_TOKEN=\n`);
  const tunnelEnvFile = path.join(sc.stateRoot, 'cf', 'tunnel-rehearsal.env');
  fs.mkdirSync(path.dirname(tunnelEnvFile), { recursive: true });
  fs.writeFileSync(tunnelEnvFile, `TUNNEL_TOKEN=${TUNNEL}\n`);
  const localDir = path.join(sc.stateRoot, 'rehearsal');
  /** @param {string} name */
  const local = (name) => fs.readFileSync(path.join(localDir, name), 'utf8');
  /** @param {object} [extra] */
  const deps = (extra = {}) => sc.deps({ paths: { stateRoot: sc.stateRoot, examplesDir, tunnelEnvFile: () => tunnelEnvFile }, platform: 'linux', ...extra });
  return { sc, localDir, local, deps };
}

/** Усі секретні значення з локальних файлів. @param {ReturnType<typeof world>} w */
function secretsOf(w) {
  return [
    ...GENERATED.map((n) => getVar(w.local('server.env'), n)),
    getVar(w.local('server.env'), 'DATABASE_URI'),
    getVar(w.local('postgres.env'), 'POSTGRES_PASSWORD'),
    getVar(w.local('redis.env'), 'REDIS_PASSWORD'),
    getVar(w.local('server.env'), 'REDIS_URL'),
  ].map(String);
}

/** Жодне значення — ні в argv, ні у виводі, ні в журналі. @param {ReturnType<typeof world>} w @param {string[]} values */
function expectNowhere(w, values) {
  const visible = [JSON.stringify(w.sc.fx.calls), w.sc.out.join('\n'), w.sc.err.join('\n'), w.sc.journalText()].join('\n');
  for (const v of values) expect(visible.includes(v)).toBe(false);
}

describe('edge-secret --generate', () => {
  it('fills empty values with distinct 32-byte secrets and derives the rest', async () => {
    const w = world();
    expect(await main(GEN, w.deps())).toBe(0);

    const [payload, edge, uri, pgPass] = secretsOf(w);
    for (const v of [payload, edge, pgPass]) {
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(new Set([payload, edge, pgPass]).size).toBe(3);

    const u = new URL(uri);
    expect(u.protocol).toBe('postgres:');
    expect(u.hostname).toBe('postgres');
    expect(u.port).toBe('5432');
    expect(u.pathname).toBe('/t2f_rehearsal');
    expect(u.username).toBe('t2f');
    expect(decodeURIComponent(u.password)).toBe(pgPass);

    const srv = w.local('server.env');
    // S1: Redis з паролем — той самий у redis.env і в REDIS_URL.
    const redisPass = String(getVar(w.local('redis.env'), 'REDIS_PASSWORD'));
    expect(redisPass).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(new Set([payload, edge, pgPass, redisPass]).size).toBe(4);
    const ru = new URL(String(getVar(srv, 'REDIS_URL')));
    expect([ru.protocol, ru.hostname, ru.port, ru.pathname, ru.username]).toEqual(['redis:', 'redis', '6379', '/0', '']);
    expect(decodeURIComponent(ru.password)).toBe(redisPass);
    expect(getVar(srv, 'T2F_REDIS_PREFIX')).toBe('t2f:rehearsal:');
    expect(getVar(srv, 'T2F_EDGE_SECRET_PREVIOUS')).toBe('');
    expect(getVar(w.local('postgres.env'), 'POSTGRES_USER')).toBe('t2f');
    expect(getVar(w.local('postgres.env'), 'POSTGRES_DB')).toBe('t2f_rehearsal');
    expect(getVar(w.local('cloudflared.env'), 'TUNNEL_TOKEN')).toBe(TUNNEL);
    expect(srv.startsWith('# names only')).toBe(true);

    // Worker: `wrangler secret put T2F_EDGE_SECRET`, значення — лише на stdin (43 символи + перевод рядка).
    const puts = w.sc.wranglerCalls().filter((c) => c.argv.includes('secret'));
    expect(puts).toHaveLength(1);
    expect(puts[0].argv.slice(2, 5)).toEqual(['secret', 'put', 'T2F_EDGE_SECRET']);
    expect(puts[0].inputLength).toBe(edge.length + 1);
    expect(fs.existsSync(path.join(w.localDir, WORKER_PENDING))).toBe(false);

    const text = w.sc.out.join('\n');
    expect(text).toContain('server.env PAYLOAD_SECRET — згенеровано');
    expect(text).toContain('T2F_EDGE_SECRET — надіслано у Worker');
    expectNowhere(w, [...secretsOf(w), TUNNEL]);
  });

  it('a second run generates nothing and keeps every value', async () => {
    const w = world();
    expect(await main(GEN, w.deps())).toBe(0);
    const before = NODE_ENV_FILES.map((n) => w.local(n));
    w.sc.out.length = 0;
    const callsBefore = w.sc.wranglerCalls().length;

    expect(await main(GEN, w.deps())).toBe(0);
    expect(NODE_ENV_FILES.map((n) => w.local(n))).toEqual(before);
    expect(w.sc.wranglerCalls()).toHaveLength(callsBefore);
    const text = w.sc.out.join('\n');
    expect(text).not.toContain('згенеровано');
    expect(text).toContain('server.env T2F_EDGE_SECRET — вже було');
    expect(text).toContain('postgres.env POSTGRES_PASSWORD — вже було');
  });

  it('pushes all three files to the node through stdin, owner values included', async () => {
    const w = world({ target: HOST });
    // Власник заповнив ключ R2 у .local до генерації.
    fs.mkdirSync(w.localDir, { recursive: true });
    fs.writeFileSync(path.join(w.localDir, 'server.env'), `T2F_R2_SECRET_ACCESS_KEY=${OWNER_R2}\nPAYLOAD_SECRET=\n`);
    const base = /** @type {import('../lib/exec.mjs').Transport} */ (w.sc.transport);
    /** @type {Map<string, string>} */
    const pushed = new Map();
    /** @type {import('../lib/exec.mjs').Transport} */
    const transport = {
      ...base,
      async exec(argv, opts = {}) {
        if (argv[2] === PUSH_SCRIPT) pushed.set(argv[4], String(opts.input));
        return base.exec(argv, opts);
      },
    };

    expect(await main([...GEN, '--target', HOST], w.deps({ transport: () => transport }))).toBe(0);
    const pushCalls = w.sc.fx.calls.filter((c) => c.argv[2] === PUSH_SCRIPT);
    expect(pushCalls.map((c) => c.argv)).toEqual(
      NODE_ENV_FILES.map((n) => ['sh', '-c', PUSH_SCRIPT, '_', `/srv/t2f/rehearsal/${n}`]),
    );
    for (const n of NODE_ENV_FILES) expect(pushed.get(`/srv/t2f/rehearsal/${n}`)).toBe(w.local(n));
    expect(getVar(w.local('server.env'), 'T2F_R2_SECRET_ACCESS_KEY')).toBe(OWNER_R2);
    // Під замком вузла.
    expect(w.sc.fx.calls.some((c) => c.argv[0] === 'flock')).toBe(true);
    expect(w.sc.out.join('\n')).toContain('server.env — надіслано');
    expectNowhere(w, [...secretsOf(w), OWNER_R2, TUNNEL]);
  });

  it('local target copies the files into the node state directory', async () => {
    const w = world();
    expect(await main([...GEN, '--target', 'local'], w.deps())).toBe(0);
    for (const n of NODE_ENV_FILES) expect(fs.readFileSync(w.sc.nodeFile(n), 'utf8')).toBe(w.local(n));
  });

  it.skipIf(process.platform === 'win32')('writes local and copied files with mode 0600 on POSIX', async () => {
    const w = world();
    expect(await main([...GEN, '--target', 'local'], w.deps({ platform: process.platform }))).toBe(0);
    for (const n of NODE_ENV_FILES) {
      expect(fs.statSync(path.join(w.localDir, n)).mode & 0o777).toBe(0o600);
      expect(fs.statSync(w.sc.nodeFile(n)).mode & 0o777).toBe(0o600);
    }
  });

  it('on Windows requires every secret path to be git-ignored', async () => {
    const w = world();
    expect(await main([...GEN, '--target', 'local'], w.deps({ platform: 'win32' }))).toBe(0);
    const checked = w.sc.fx.calls.filter((c) => c.argv[0] === 'git' && c.argv[1] === 'check-ignore').map((c) => c.argv[3]);
    for (const n of NODE_ENV_FILES) {
      expect(checked).toContain(path.join(w.localDir, n));
      expect(checked).toContain(w.sc.nodeFile(n));
    }
  });

  it('on Windows refuses with 2 and writes nothing when a path is not git-ignored', async () => {
    const w = world();
    const exec = {
      ...w.sc.exec,
      /** @type {typeof w.sc.exec.run} */
      run: (file, args, opts) =>
        file === 'git' && args[0] === 'check-ignore' ? Promise.resolve({ code: 1, stdout: '', stderr: '' }) : w.sc.exec.run(file, args, opts),
    };
    expect(await main(GEN, w.deps({ platform: 'win32', exec }))).toBe(2);
    expect(fs.existsSync(w.localDir)).toBe(false);
    expect(w.sc.err.join('\n')).toContain('не git-ignored');
  });

  it('refuses any env other than rehearsal with 2', async () => {
    const w = world();
    expect(await main(['edge-secret', '--env', 'production', '--generate'], w.deps())).toBe(2);
    expect(await main(['edge-secret', '--env', 'prelaunch', '--generate'], w.deps())).toBe(2);
    expect(fs.existsSync(w.localDir)).toBe(false);
    expect(w.sc.fx.calls).toHaveLength(0);
  });

  it('refuses with 2 before writing when an example is missing', async () => {
    const w = world();
    fs.rmSync(path.join(w.sc.stateRoot, 'examples', 'postgres.env.example'));
    expect(await main(GEN, w.deps())).toBe(2);
    expect(fs.existsSync(w.localDir)).toBe(false);
    expect(w.sc.err.join('\n')).toContain('postgres.env.example');
  });

  it('a failed Worker write leaves a pending mark, and the rerun sends the same secret again', async () => {
    const w = world();
    /** @type {{ name: string, value: string }[]} */
    const puts = [];
    let fail = true;
    const worker = {
      missingCredentials: () => [],
      /** @param {string} name @param {string} value */
      putSecret: async (name, value) => {
        puts.push({ name, value });
        return fail ? { code: 1, message: 'wrangler secret put T2F_EDGE_SECRET завершився з кодом 1' } : { code: 0 };
      },
    };
    expect(await main(GEN, w.deps({ worker: () => worker }))).toBe(1);
    expect(fs.existsSync(path.join(w.localDir, WORKER_PENDING))).toBe(true);

    fail = false;
    expect(await main(GEN, w.deps({ worker: () => worker }))).toBe(0);
    const edge = getVar(w.local('server.env'), 'T2F_EDGE_SECRET');
    expect(puts.map((p) => p.value)).toEqual([edge, edge]);
    expect(fs.existsSync(path.join(w.localDir, WORKER_PENDING))).toBe(false);
    expectNowhere(w, secretsOf(w));
  });

  it('refuses with 2 before writing when Cloudflare credentials are missing for a new edge secret', async () => {
    const w = world();
    expect(await main(GEN, w.deps({ env: {} }))).toBe(2);
    expect(fs.existsSync(w.localDir)).toBe(false);
  });
});

describe('edge-secret --generate: Redis password upgrade of a deployed node (S1)', () => {
  /** Стан вузла до пароля Redis: усе заповнено, `REDIS_URL` без пароля, `redis.env` немає. */
  async function legacyWorld() {
    const w = world();
    expect(await main(GEN, w.deps())).toBe(0);
    fs.rmSync(path.join(w.localDir, 'redis.env'));
    const srv = w.local('server.env').replace(/^REDIS_URL=.*$/m, `REDIS_URL=${REDIS_URL_BASE}`);
    fs.writeFileSync(path.join(w.localDir, 'server.env'), srv);
    w.sc.out.length = 0;
    return w;
  }

  it('generates the password, rewrites REDIS_URL with it, keeps every other value and pushes the files', async () => {
    const w = await legacyWorld();
    const before = w.local('server.env');
    const callsBefore = w.sc.wranglerCalls().length;

    expect(await main([...GEN, '--target', 'local'], w.deps())).toBe(0);
    const pass = String(getVar(w.local('redis.env'), 'REDIS_PASSWORD'));
    expect(pass).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const u = new URL(String(getVar(w.local('server.env'), 'REDIS_URL')));
    expect([u.hostname, u.port, u.pathname]).toEqual(['redis', '6379', '/0']);
    expect(decodeURIComponent(u.password)).toBe(pass);
    for (const n of ['DATABASE_URI', 'PAYLOAD_SECRET', 'T2F_EDGE_SECRET', 'T2F_REDIS_PREFIX']) {
      expect(getVar(w.local('server.env'), n), n).toBe(getVar(before, n));
    }
    for (const n of NODE_ENV_FILES) expect(fs.readFileSync(w.sc.nodeFile(n), 'utf8')).toBe(w.local(n));
    expect(w.sc.wranglerCalls()).toHaveLength(callsBefore);
    const text = w.sc.out.join('\n');
    expect(text).toContain('redis.env REDIS_PASSWORD — згенеровано');
    expect(text).toContain('server.env REDIS_URL — оновлено (пароль Redis)');
    expectNowhere(w, secretsOf(w));
  });

  it('keeps a REDIS_URL host and database other than the default', async () => {
    const w = await legacyWorld();
    fs.writeFileSync(path.join(w.localDir, 'server.env'), w.local('server.env').replace(/^REDIS_URL=.*$/m, 'REDIS_URL=redis://cache:6380/2'));
    expect(await main(GEN, w.deps())).toBe(0);
    const u = new URL(String(getVar(w.local('server.env'), 'REDIS_URL')));
    expect([u.hostname, u.port, u.pathname]).toEqual(['cache', '6380', '/2']);
    expect(decodeURIComponent(u.password)).toBe(getVar(w.local('redis.env'), 'REDIS_PASSWORD'));
  });

  it('after the upgrade a rerun changes nothing', async () => {
    const w = await legacyWorld();
    expect(await main(GEN, w.deps())).toBe(0);
    const before = NODE_ENV_FILES.map((n) => w.local(n));
    expect(await main(GEN, w.deps())).toBe(0);
    expect(NODE_ENV_FILES.map((n) => w.local(n))).toEqual(before);
    expect(w.sc.out.join('\n')).toContain('server.env REDIS_URL — вже було');
  });

  it('refuses with 2 and writes nothing when REDIS_URL carries a password that redis.env does not hold', async () => {
    const w = await legacyWorld();
    const withPass = redisUrl(REDIS_URL_BASE, 'not-the-redis-password-0123456789abcdef'); // check-secrets: allow fake password (S1 test)
    fs.writeFileSync(path.join(w.localDir, 'server.env'), w.local('server.env').replace(/^REDIS_URL=.*$/m, `REDIS_URL=${withPass}`));
    const before = w.local('server.env');
    expect(await main(GEN, w.deps())).toBe(2);
    expect(w.local('server.env')).toBe(before);
    expect(fs.existsSync(path.join(w.localDir, 'redis.env'))).toBe(false);
    expect(w.sc.err.join('\n')).toContain('REDIS_PASSWORD');
    expectNowhere(w, [withPass]);
  });
});
