// @ts-check
// W18 — образ сервера: збірка з архіву коміту (AC-1), доставка, прибирання (AC-16), відмова за диском (AC-18).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createImage, imageTag, keepShas, shaOfImage } from '../lib/image.mjs';
import { main } from '../ops.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { scenario } from './support/scenario.mjs';

const S = (/** @type {string} */ c) => c.repeat(40);
const [S1, S2, S3, S4, S5] = ['1', '2', '3', '4', '5'].map(S);

/** Підставний `start`: потік з байтами й заданим кодом. @param {{ code?: number, calls?: string[][] }} [o] */
function fakeStart(o = {}) {
  return (/** @type {string} */ file, /** @type {string[]} */ args) => {
    o.calls?.push([file, ...args]);
    const stdout = new PassThrough();
    stdout.end(Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72])); // байти, не текст
    return { stdout, stdin: null, done: Promise.resolve({ code: o.code ?? 0, stdout: '', stderr: '' }), kill: () => {} };
  };
}

/** @param {{ code?: number }} [o] */
const fakeGit = (o = {}) => ({ archive: () => fakeStart(o)('git', ['archive']) });

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('image tags', () => {
  it('tags with the full 40-hex SHA and parses it back from a journal ref', () => {
    expect(imageTag(S1)).toBe(`t2f-server:${S1}`);
    expect(() => imageTag('abc1234')).toThrow(/40 hex/);
    expect(shaOfImage(`t2f-server:${S2}`)).toBe(S2);
    expect(shaOfImage('t2f-server:latest')).toBeNull();
    expect(shaOfImage(null)).toBeNull();
  });
});

describe('buildImage', () => {
  it('reuses an existing local tag: no archive, no build', async () => {
    const fx = createFakeExec([{ match: ['docker', 'image', 'inspect'], result: { code: 0 } }]);
    const starts = /** @type {string[][]} */ ([]);
    const img = createImage({ local: fx.localTransport(), git: { archive: () => fakeStart({ calls: starts })('git', ['archive']) } });
    expect(await img.buildImage(S1)).toEqual({ code: 0, skipped: true });
    expect(fx.calls.map((c) => c.argv.slice(0, 2).join(' '))).toEqual(['docker image']);
    expect(starts).toEqual([]);
  });

  it('pipes git archive into docker build with the commit build-arg and the SHA tag', async () => {
    const fx = createFakeExec([{ match: ['docker', 'image', 'inspect'], result: { code: 1 } }]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit() });
    expect(await img.buildImage(S1)).toEqual({ code: 0, skipped: false });
    const build = fx.calls[1];
    expect(build.argv).toEqual(['docker', 'build', '-f', 'server/Dockerfile', '--build-arg', `T2F_COMMIT=${S1}`, '-t', `t2f-server:${S1}`, '-']);
    expect(build.inputLength).toBe(5); // архів пішов на stdin
  });

  it('a failed git archive fails the build and removes a tag built from a truncated stream', async () => {
    const fx = createFakeExec([{ match: ['docker', 'image', 'inspect'], result: { code: 1 } }]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit({ code: 128 }) });
    const r = await img.buildImage(S1);
    expect(r.code).toBe(1);
    expect(fx.calls.at(-1)?.argv).toEqual(['docker', 'image', 'rm', `t2f-server:${S1}`]);
  });

  it('falls back to an extracted folder when BuildKit rejects -f with a stdin context', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-img-'));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const fx = createFakeExec([
      { match: ['docker', 'image', 'inspect'], result: { code: 1 } },
      { match: (c) => c.argv[1] === 'build' && c.argv.at(-1) === '-', result: { code: 1, stderr: 'failed to read dockerfile: open server/Dockerfile: no such file or directory' } },
    ]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit(), tmpdir: () => tmp });
    expect(await img.buildImage(S1)).toEqual({ code: 0, skipped: false });
    const [, , untar, build] = fx.calls;
    expect(untar.argv.slice(0, 4)).toEqual(['tar', '-xf', '-', '-C']);
    const dir = untar.argv[4];
    expect(build.argv).toEqual(['docker', 'build', '-f', path.join(dir, 'server', 'Dockerfile'), '--build-arg', `T2F_COMMIT=${S1}`, '-t', `t2f-server:${S1}`, dir]);
    expect(fs.existsSync(dir)).toBe(false); // тимчасову теку прибрано
  });
});

describe('deliver', () => {
  it('skips when the node already has the tag', async () => {
    const fx = createFakeExec([{ match: ['docker', 'image', 'inspect'], result: { code: 0 } }]);
    const starts = /** @type {string[][]} */ ([]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit(), start: fakeStart({ calls: starts }) });
    const node = fx.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/kh' });
    expect(await img.deliver(node, S1)).toEqual({ code: 0, skipped: true });
    expect(starts).toEqual([]);
    expect(fx.calls.some((c) => c.argv.join(' ') === 'docker load')).toBe(false);
  });

  it('docker save | gzip | docker load on the node', async () => {
    const fx = createFakeExec([{ match: ['docker', 'image', 'inspect'], result: { code: 1 } }]);
    const starts = /** @type {string[][]} */ ([]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit(), start: fakeStart({ calls: starts }) });
    const node = fx.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/kh' });
    expect(await img.deliver(node, S1)).toEqual({ code: 0, skipped: false });
    expect(starts).toEqual([['docker', 'save', `t2f-server:${S1}`]]);
    const load = fx.callsOf('ssh:203.0.113.10').find((c) => c.argv.join(' ') === 'docker load');
    expect(load?.inputLength).toBeGreaterThan(10); // gzip-заголовок + дані
  });

  it('a failed docker load fails delivery', async () => {
    const fx = createFakeExec([
      { match: ['docker', 'image', 'inspect'], result: { code: 1 } },
      { match: ['docker', 'load'], result: { code: 1, stderr: 'no space left on device' } },
    ]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit(), start: fakeStart() });
    const r = await img.deliver(fx.localTransport(), S1);
    expect(r.code).toBe(1);
  });
});

describe('retention (AC-16)', () => {
  it('five deploys in a row keep the three latest SHAs', () => {
    expect(keepShas({ current: S5, previous: S4, deployed: [S5, S4, S3, S2, S1] })).toEqual([S5, S4, S3]);
  });

  it('always keeps current and previous on top of the three most recent', () => {
    // Після відкату попередній — старий образ S1.
    expect(keepShas({ current: S5, previous: S1, deployed: [S5, S4, S3, S2] })).toEqual([S5, S1, S4, S3]);
  });

  it('retain removes every other t2f-server SHA tag on the node and nothing else', async () => {
    const fx = createFakeExec([
      { match: ['docker', 'image', 'ls'], result: { stdout: [S1, S2, S3, S4, S5, 'latest', '<none>'].join('\n') } },
    ]);
    const img = createImage({ local: fx.localTransport(), git: fakeGit() });
    const node = fx.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/kh' });
    const r = await img.retain(node, keepShas({ current: S5, previous: S4, deployed: [S5, S4, S3, S2, S1] }));
    expect(r).toEqual({ removed: [S1, S2], failed: [] });
    expect(fx.calls.map((c) => c.argv.join(' '))).toEqual([
      'docker image ls t2f-server --format {{.Tag}}',
      `docker image rm t2f-server:${S1}`,
      `docker image rm t2f-server:${S2}`,
    ]);
  });
});

describe('disk (AC-18)', () => {
  it('4.9 GB free → deploy refuses with code 2 before delivery: 0 docker load, 0 build', async () => {
    const sc = scenario({ target: 'ssh', running: S1 });
    cleanups.push(sc.cleanup);
    sc.st.freeKb = String(Math.round(4.9 * 1024 * 1024));
    const code = await main(['deploy', '--env', 'rehearsal', '--target', '203.0.113.10'], sc.deps());
    expect(code).toBe(2);
    expect(sc.err.join('\n')).toMatch(/4\.9 ГБ/);
    expect(sc.fx.calls.filter((c) => c.argv.join(' ') === 'docker load')).toHaveLength(0);
    expect(sc.fx.calls.filter((c) => c.argv[1] === 'build')).toHaveLength(0);
    expect(sc.journal()).toEqual([]);
  });
});
