// @ts-check
// AC-11 (брудне дерево → відмова до збірки), AC-10 (`--commit` має бути комітом), AC-1 (архів дерева коміту).
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { start } from '../lib/exec.mjs';
import { createGit } from '../lib/git.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const SHA = 'a'.repeat(40);

/** Лише git; будь-яка збірка (docker, next, wrangler) — порушення. @param {ReturnType<typeof createFakeExec>} fake */
const buildCalls = (fake) => fake.calls.filter((c) => c.argv[0] !== 'git');

describe('assertClean', () => {
  it('a modified file → refusal with code 2 and no build call', async () => {
    const fake = createFakeExec([{ match: ['git', 'status'], result: { stdout: ' M server/src/container.ts\0' } }]);
    const r = await createGit({ exec: fake }).assertClean();
    expect(r).toEqual({ code: 2, message: 'робоче дерево має незакомічені зміни' });
    expect(fake.calls.map((c) => c.argv)).toEqual([['git', 'status', '--porcelain=v1', '-z']]);
    expect(buildCalls(fake)).toHaveLength(0);
  });

  it('an untracked file → refusal', async () => {
    const fake = createFakeExec([{ match: ['git', 'status'], result: { stdout: '?? notes.txt\0' } }]);
    expect((await createGit({ exec: fake }).assertClean()).code).toBe(2);
  });

  it('a failing git status → refusal, never "clean"', async () => {
    const fake = createFakeExec([{ match: ['git', 'status'], result: { code: 128, stderr: 'not a git repository' } }]);
    expect((await createGit({ exec: fake }).assertClean()).code).toBe(2);
  });

  it('an empty status → clean', async () => {
    const fake = createFakeExec([{ match: ['git', 'status'], result: { stdout: '' } }]);
    expect(await createGit({ exec: fake }).assertClean()).toEqual({ code: 0 });
  });
});

describe('resolveCommit', () => {
  it('an unknown SHA → code 2 naming --commit', async () => {
    const fake = createFakeExec([{ match: ['git', 'rev-parse'], result: { code: 1 } }]);
    const r = await createGit({ exec: fake }).resolveCommit('deadbee');
    expect(r.code).toBe(2);
    expect(r.code === 2 && r.message).toContain('--commit');
    expect(fake.calls[0].argv).toEqual(['git', 'rev-parse', '--verify', '--quiet', 'deadbee^{commit}']);
  });

  it('a malformed value → code 2 and git is not called', async () => {
    const fake = createFakeExec();
    for (const bad of ['HEAD', 'abc', '$(id)', 'a;b', 'A'.repeat(40), 'a'.repeat(41)]) {
      expect((await createGit({ exec: fake }).resolveCommit(bad)).code).toBe(2);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it('a commit → the full 40-hex SHA; no argument → HEAD', async () => {
    const fake = createFakeExec([{ match: ['git', 'rev-parse'], result: { stdout: `${SHA}\n` } }]);
    const git = createGit({ exec: fake });
    expect(await git.resolveCommit('aaaaaaa')).toEqual({ code: 0, sha: SHA });
    expect(await git.resolveCommit()).toEqual({ code: 0, sha: SHA });
    expect(fake.calls[1].argv[4]).toBe('HEAD^{commit}');
  });

  it('the real repository resolves HEAD to a commit', async () => {
    const r = await createGit().resolveCommit();
    expect(r.code).toBe(0);
    expect(r.code === 0 && r.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('archive', () => {
  it('starts git archive with the fixed argv and returns the stream', () => {
    /** @type {{ file: string, args: string[] }[]} */
    const started = [];
    const stdout = new PassThrough();
    /** @type {typeof start} */
    const fakeStart = (file, args) => {
      started.push({ file, args });
      return { stdout, stdin: null, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }), kill: () => {} };
    };
    const h = createGit({ start: fakeStart }).archive(SHA);
    expect(started).toEqual([{ file: 'git', args: ['archive', '--format=tar', SHA] }]);
    expect(h.stdout).toBe(stdout);
  });

  it('refuses anything but a full SHA', () => {
    const git = createGit({ start: () => { throw new Error('must not start'); } });
    expect(() => git.archive('HEAD')).toThrow(TypeError);
    expect(() => git.archive('--output=/tmp/x')).toThrow(TypeError);
  });

  it('the real stream helper delivers all output and the exit code', async () => {
    const h = start(process.execPath, ['-e', 'process.stdout.write("x".repeat(70000)); process.exitCode = 3']);
    let n = 0;
    for await (const chunk of h.stdout) n += chunk.length;
    expect(n).toBe(70000);
    expect((await h.done).code).toBe(3);
  });
});
