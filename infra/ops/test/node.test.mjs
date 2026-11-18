// @ts-check
// W18 — вузол: точний argv кожного виклику Compose, жодного `down` (A02), диск (AC-18), очікування здоров’я (AC-13).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeArgv,
  createNode,
  MIN_FREE_BYTES,
  parseCurrentSha,
  parseDfAvailable,
  serviceImage,
} from '../lib/node.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { COMPOSE_TEXT, PINNED_POSTGRES } from './support/scenario.mjs';

const SHA = 'd'.repeat(40);
const DIR = '/srv/t2f/rehearsal';
const BASE = ['docker', 'compose', '-p', 't2f-rehearsal', '-f', `${DIR}/compose.yml`];

const clockAt = () => ({
  t: 0,
  now() {
    return this.t;
  },
  /** @param {number} ms */
  sleep(ms) {
    this.t += ms;
    return Promise.resolve();
  },
});

/** @param {import('./support/fakeExec.mjs').Script[]} [script] */
function remote(script = []) {
  const fx = createFakeExec(script);
  const transport = fx.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/kh' });
  const clock = clockAt();
  const node = createNode({ transport, env: 'rehearsal', project: 't2f-rehearsal', nodeDir: DIR, clock });
  return { fx, node, clock };
}

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('pure helpers', () => {
  it('composeArgv: project, file and interpolation env file from the node dir', () => {
    expect(composeArgv({ project: 't2f-rehearsal', nodeDir: DIR, local: false }, 'next.env', ['ps'])).toEqual([
      ...BASE, '--env-file', `${DIR}/next.env`, 'ps',
    ]);
  });

  it('parses df -Pk, the pinned postgres image and current.env', () => {
    expect(parseDfAvailable('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100 50 5138022 50% /var/lib/docker\n')).toBe(5138022 * 1024);
    expect(parseDfAvailable('garbage')).toBeNull();
    expect(serviceImage(COMPOSE_TEXT, 'postgres')).toBe(PINNED_POSTGRES);
    expect(serviceImage(COMPOSE_TEXT, 'redis')).toBeNull();
    expect(parseCurrentSha(`T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA}\n`)).toBe(SHA);
    expect(parseCurrentSha('T2F_SERVER_SHA=abc\n')).toBeNull();
  });
});

describe('remote node argv', () => {
  it('freeBytes: df -Pk /var/lib/docker; below 5 GB → code 2', async () => {
    const kb = Math.floor((MIN_FREE_BYTES - 1) / 1024);
    const { fx, node } = remote([{ match: ['df'], result: { stdout: `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 1 1 ${kb} 1% /\n` } }]);
    const r = await node.freeBytes(COMPOSE_TEXT);
    expect(r.code).toBe(2);
    expect(fx.calls.map((c) => c.argv)).toEqual([['df', '-Pk', '/var/lib/docker']]);
  });

  it('uploadCompose / prepare / setCurrent write atomically through sh, with the content on stdin', async () => {
    const { fx, node } = remote();
    await node.uploadCompose(COMPOSE_TEXT);
    await node.prepare(SHA);
    await node.setCurrent(SHA);
    const script = 'cat > "$1.tmp" && mv "$1.tmp" "$1"';
    expect(fx.calls.map((c) => c.argv)).toEqual([
      ['sh', '-c', script, '_', `${DIR}/compose.yml`],
      ['sh', '-c', script, '_', `${DIR}/next.env`],
      ['sh', '-c', script, '_', `${DIR}/current.env`],
    ]);
    expect(fx.calls[0].inputLength).toBe(Buffer.byteLength(COMPOSE_TEXT));
    expect(fx.calls[1].inputLength).toBe(Buffer.byteLength(`T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA}\n`));
  });

  it('migrate: postgres and redis up with --wait, then a one-shot server container runs pnpm migrate', async () => {
    const { fx, node } = remote();
    expect(await node.migrate()).toEqual({ code: 0 });
    expect(fx.calls.map((c) => c.argv)).toEqual([
      [...BASE, '--env-file', `${DIR}/next.env`, 'up', '-d', '--wait', 'postgres', 'redis'],
      [...BASE, '--env-file', `${DIR}/next.env`, 'run', '--rm', '--no-deps', 'server', 'pnpm', 'migrate'],
    ]);
  });

  it('a failing migration is a step failure', async () => {
    const { node } = remote([{ match: (c) => c.argv.includes('migrate'), result: { code: 1, stderr: 'boom' } }]);
    const r = await node.migrate();
    expect(r.code).toBe(1);
  });

  it('swap recreates only the server; cloudflared starts only when cloudflared.env has a token', async () => {
    const without = remote([{ match: ['grep'], result: { code: 1 } }]);
    expect(await without.node.swap('next.env')).toEqual({ code: 0 });
    expect(without.fx.calls.map((c) => c.argv)).toEqual([
      [...BASE, '--env-file', `${DIR}/next.env`, 'up', '-d', '--no-deps', '--force-recreate', 'server'],
      ['grep', '-q', '^TUNNEL_TOKEN=.', `${DIR}/cloudflared.env`],
    ]);
    const withToken = remote([{ match: ['grep'], result: { code: 0 } }]);
    await withToken.node.swap('current.env');
    expect(withToken.fx.calls.map((c) => c.argv).at(-1)).toEqual([...BASE, '--env-file', `${DIR}/current.env`, 'up', '-d', '--no-deps', 'cloudflared']);
  });

  it('waitHealthy polls health-probe inside the server container until it prints 200 <sha>', async () => {
    let n = 0;
    const { fx, node, clock } = remote([
      { match: (c) => c.argv.includes('exec'), result: () => (++n < 4 ? { code: 1, stdout: '503 -\n' } : { stdout: `200 ${SHA}\n` }) },
    ]);
    expect(await node.waitHealthy('next.env', SHA)).toEqual({ code: 0 });
    expect(fx.calls).toHaveLength(4);
    expect(fx.calls[0].argv).toEqual([...BASE, '--env-file', `${DIR}/next.env`, 'exec', '-T', 'server', 'node', 'scripts/health-probe.mjs']);
    expect(clock.t).toBe(3000);
  });

  it('waitHealthy gives up after 60 s; a 200 from another SHA does not count', async () => {
    const { fx, node, clock } = remote([{ match: (c) => c.argv.includes('exec'), result: { stdout: `200 ${'e'.repeat(40)}\n` } }]);
    const r = await node.waitHealthy('next.env', SHA);
    expect(r.code).toBe(1);
    expect(clock.t).toBeLessThanOrEqual(60_000);
    expect(fx.calls.length).toBeGreaterThanOrEqual(59);
  });

  it('no compose call contains down, and nothing touches volumes', async () => {
    const { fx, node } = remote([{ match: ['grep'], result: { code: 0 } }, { match: (c) => c.argv.includes('exec'), result: { stdout: `200 ${SHA}\n` } }]);
    await node.freeBytes(COMPOSE_TEXT);
    await node.uploadCompose(COMPOSE_TEXT);
    await node.prepare(SHA);
    await node.migrate();
    await node.swap('next.env');
    await node.waitHealthy('next.env', SHA);
    await node.setCurrent(SHA);
    await node.readCurrent();
    for (const c of fx.calls) {
      expect(c.argv).not.toContain('down');
      expect(c.argv).not.toContain('-v');
      expect(c.argv).not.toContain('--volumes');
      expect(c.argv.join(' ')).not.toMatch(/volume/);
    }
  });
});

describe('local node', () => {
  it('freeBytes runs df in a one-shot container of the pinned postgres image; an unpinned image refuses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-node-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fx = createFakeExec([{ match: ['docker', 'run'], result: { stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 1 1 99999999 1% /\n' } }]);
    const node = createNode({ transport: fx.localTransport(), env: 'rehearsal', project: 't2f-node-rehearsal', nodeDir: dir });
    expect((await node.freeBytes(COMPOSE_TEXT)).code).toBe(0);
    expect(fx.calls[0].argv).toEqual(['docker', 'run', '--rm', '--entrypoint', 'df', PINNED_POSTGRES, '-Pk', '/']);
    expect((await node.freeBytes(COMPOSE_TEXT.replace(/@sha256:0+/, ''))).code).toBe(2);
    expect(fx.calls).toHaveLength(1);
  });

  it('writes compose.yml and the interpolation files into the state dir; reads the tunnel token without printing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-node-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fx = createFakeExec();
    const node = createNode({ transport: fx.localTransport(), env: 'rehearsal', project: 't2f-node-rehearsal', nodeDir: dir });
    await node.uploadCompose(COMPOSE_TEXT);
    await node.setCurrent(SHA);
    expect(fs.readFileSync(path.join(dir, 'compose.yml'), 'utf8')).toBe(COMPOSE_TEXT);
    expect(await node.readCurrent()).toBe(SHA);
    expect(fs.readdirSync(dir).sort()).toEqual(['compose.yml', 'current.env']);

    fs.writeFileSync(path.join(dir, 'cloudflared.env'), 'TUNNEL_TOKEN=\n');
    await node.swap('current.env');
    expect(fx.calls.some((c) => c.argv.includes('cloudflared'))).toBe(false);
    fs.writeFileSync(path.join(dir, 'cloudflared.env'), 'TUNNEL_TOKEN=abc123\n');
    await node.swap('current.env');
    expect(fx.calls.at(-1)?.argv).toEqual([
      'docker', 'compose', '-p', 't2f-node-rehearsal', '-f', path.join(dir, 'compose.yml'),
      '--env-file', path.join(dir, 'current.env'), 'up', '-d', '--no-deps', 'cloudflared',
    ]);
  });
});
