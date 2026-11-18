import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runRealtimeConfig, type CliIo } from '../../src/cli/realtimeConfig';
import { ensureRealtimeSecrets, realtimeSecretsFile } from '../../scripts/lib/realtimeSecrets.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const dirs: string[] = [];
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-stack-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const capture = (): { io: CliIo; err: string[] } => {
  const err: string[] = [];
  return { io: { out: () => undefined, err: (line) => err.push(line) }, err };
};

const gitAvailable = spawnSync('git', ['--version']).status === 0;

describe('realtime secrets file (AC-60)', () => {
  it('creates two different 64-char values once and returns the same values after', () => {
    const file = path.join(tmp(), 'realtime', 'centrifugo.env');
    const first = ensureRealtimeSecrets(file);
    const second = ensureRealtimeSecrets(file);
    expect(second).toEqual(first);
    expect(first.T2F_CENTRIFUGO_TOKEN_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(first.T2F_CENTRIFUGO_API_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(first.T2F_CENTRIFUGO_TOKEN_SECRET).not.toBe(first.T2F_CENTRIFUGO_API_KEY);
  });

  it.skipIf(!gitAvailable)('keeps the shared file out of git', () => {
    const file = realtimeSecretsFile(repoRoot, {});
    expect(file.endsWith(path.join('.claude', 'sdd', 'realtime', 'centrifugo.env'))).toBe(true);
    // The main checkout may lie outside this worktree (git refuses outside paths), so the same repo-relative path is checked.
    const r = spawnSync('git', ['check-ignore', '-q', '.claude/sdd/realtime/centrifugo.env'], { cwd: repoRoot });
    expect(r.status).toBe(0);
  });
});

describe('stack files (AC-29, AC-2)', () => {
  it('compose has no insecure Centrifugo API', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(compose).not.toContain('CENTRIFUGO_HTTP_API_INSECURE');
  });

  it('--check is 0 on the tree and 1 when a compose value differs', () => {
    expect(runRealtimeConfig(['--check'], capture().io)).toBe(0);

    const root = tmp();
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, '.github', 'workflows', 'verify.yml'), path.join(root, '.github', 'workflows', 'verify.yml'));
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain("CENTRIFUGO_CLIENT_PING_INTERVAL: '25s'");
    fs.writeFileSync(path.join(root, 'docker-compose.yml'), compose.replace("CENTRIFUGO_CLIENT_PING_INTERVAL: '25s'", "CENTRIFUGO_CLIENT_PING_INTERVAL: '99s'"));
    const { io, err } = capture();
    expect(runRealtimeConfig(['--check', '--root', root], io)).toBe(1);
    expect(err.join('\n')).toContain('docker-compose.yml CENTRIFUGO_CLIENT_PING_INTERVAL');
  });
});
