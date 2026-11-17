// @ts-check
// Замок `cloudflare` між процесами (AC-41) і місце токена поза git (AC-42).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { ENVS } from '../lib/config.mjs';
import { createFakeApi } from './support/fakeApi.mjs';

const INFRA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CF = path.join(INFRA_DIR, 'cf.mjs');
const tok = `tok-${'c9'.repeat(8)}`;

/** @type {string} */
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cf-lock-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Дочірній процес `apply --env test`. Обгортка лише підміняє теку `.local` на тимчасову,
 * щоб тест не торкався справжнього файлу токена; решта — та сама `main` з cf.mjs.
 * @param {string} apiBase
 * @param {string} local
 * @returns {Promise<{ code: number | null, out: string }>}
 */
function spawnApply(apiBase, local) {
  const code = `import { main } from ${JSON.stringify(pathToFileURL(CF).href)};
main(['apply', '--env', 'test'], { localDir: process.env.T2F_TEST_LOCAL_DIR }).then((c) => { process.exitCode = c; });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: INFRA_DIR,
    env: {
      ...process.env,
      CLOUDFLARE_API_BASE: apiBase,
      CLOUDFLARE_API_TOKEN_INFRA: tok,
      CLOUDFLARE_ACCOUNT_ID: 'acct-test',
      CLOUDFLARE_ZONE_ID: 'zone-test',
      T2F_LOCK_DIR: path.join(tmp, 'locks'),
      T2F_TEST_LOCAL_DIR: local,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += String(c)));
  child.stderr.on('data', (c) => (out += String(c)));
  return new Promise((resolve) => child.on('close', (c) => resolve({ code: c, out })));
}

describe('замок cloudflare', () => {
  it('два apply одночасно: змін стільки ж, як в одного; рівно один «без змін» (AC-41)', async () => {
    // Скільки змін робить один apply на порожньому Cloudflare.
    const single = createFakeApi();
    const one = await main(['apply', '--env', 'test'], {
      env: { CLOUDFLARE_API_TOKEN_INFRA: tok, CLOUDFLARE_ACCOUNT_ID: 'acct-test', CLOUDFLARE_ZONE_ID: 'zone-test', T2F_LOCK_DIR: path.join(tmp, 'locks-single') },
      fetch: single.fetch,
      out: () => {},
      localDir: path.join(tmp, 'single-local'),
    });
    expect(one).toBe(0);
    const expected = single.mutations().length;
    expect(expected).toBeGreaterThan(0);

    const fake = createFakeApi({ mutationDelayMs: 300 });
    const server = await fake.listen();
    try {
      const local = path.join(tmp, '.local');
      const [a, b] = await Promise.all([spawnApply(server.url, local), spawnApply(server.url, local)]);
      expect([a.code, b.code]).toEqual([0, 0]);
      expect(fake.mutations().length).toBe(expected);
      expect([a.out, b.out].filter((o) => o.includes('без змін'))).toHaveLength(1);
      // по одному тунелю на середовище (cf.mjs будує всі разом), без дублікатів
      expect(fake.state.tunnels).toHaveLength(Object.keys(ENVS).length);
      expect(a.out + b.out).not.toContain(tok);
      expect(a.out + b.out).not.toContain(String(fake.state.tunnels[0]?.token));
    } finally {
      await server.close();
    }
  });

  it('файл токена тунелю ігнорується git (AC-42)', () => {
    const repo = path.resolve(INFRA_DIR, '../..');
    // execFileSync кидає на ненульовому коді, тож відсутність винятку = код 0.
    expect(() => execFileSync('git', ['check-ignore', '-q', 'infra/cloudflare/.local/tunnel-test.env'], { cwd: repo })).not.toThrow();
  });
});
