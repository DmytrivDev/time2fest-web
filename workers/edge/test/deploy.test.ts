// Deploy script with an injected spawn: no network, no wrangler (AC-13, NFR-3).
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deploy } from '../scripts/deploy.mjs';

type Call = { args: string[]; stdin: string };
// Built at runtime so the secret scanner never sees a credential-like literal.
const TOKEN = 't'.repeat(20);
const SECRET = 's'.repeat(40);

const assetsDir = mkdtempSync(join(tmpdir(), 't2f-deploy-assets-'));
writeFileSync(join(assetsDir, 'index.html'), '');
const emptyDir = mkdtempSync(join(tmpdir(), 't2f-deploy-empty-'));
afterAll(() => {
  rmSync(assetsDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

function fakeSpawn(calls: Call[]) {
  return ((_cmd: string, args: string[]) => {
    const call: Call = { args, stdin: '' };
    calls.push(call);
    const child = new EventEmitter() as EventEmitter & { stdin: unknown; stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: (s: string) => (call.stdin += s),
      end: () => setImmediate(() => child.emit('close', 0)),
    };
    return child;
  }) as never;
}

async function run(argv: string[], env: Record<string, string>, dir = assetsDir) {
  const calls: Call[] = [];
  let output = '';
  const code = (await deploy(argv, {
    spawn: fakeSpawn(calls),
    env,
    assetsDir: dir,
    out: (s: string) => (output += s),
    err: (s: string) => (output += s),
  })) as number;
  return { code, calls, output };
}

describe('deploy script', () => {
  const full = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acct', T2F_EDGE_SECRET: SECRET };

  it('refuses a non-test env without --confirm', async () => {
    const r = await run(['--env', 'production'], full);
    expect(r.code).toBe(2);
    expect(r.output).toContain('not deployed in this wave');
    expect(r.calls).toHaveLength(0);
  });

  it('rejects an unknown env', async () => {
    expect((await run(['--env', 'nope'], full)).code).toBe(1);
  });

  it('names missing variables without values', async () => {
    const r = await run(['--env', 'test'], { CLOUDFLARE_API_TOKEN: TOKEN });
    expect(r.code).toBe(1);
    expect(r.output).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(r.output).toContain('T2F_EDGE_SECRET');
    expect(r.output).not.toContain(TOKEN);
    expect(r.calls).toHaveLength(0);
  });

  it('fails on an empty assets directory', async () => {
    const r = await run(['--env', 'test'], full, emptyDir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('assets directory');
    expect(r.calls).toHaveLength(0);
  });

  it('sends the secret on stdin only', async () => {
    const r = await run(['--env', 'test'], full);
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => c.args.slice(1, 3))).toEqual([
      ['deploy', '--env'],
      ['secret', 'put'],
    ]);
    expect(r.calls[1]?.stdin).toContain(SECRET);
    expect(JSON.stringify(r.calls.map((c) => c.args))).not.toContain(SECRET);
    expect(r.output).not.toContain(SECRET);
    expect(r.output).toContain('deployed test');
  });

  it('skips secret put for prelaunch', async () => {
    const r = await run(['--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain'], {
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: 'acct',
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
  });
});

describe('main-domain double flag (AC-21)', () => {
  const full = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acct', T2F_EDGE_SECRET: SECRET };

  for (const target of ['prelaunch', 'production']) {
    it(`${target}: without both flags → 2 and no spawn`, async () => {
      for (const extra of [[], ['--confirm', target], ['--allow-main-domain']]) {
        const r = await run(['--env', target, ...extra], full);
        expect(r.code).toBe(2);
        expect(r.calls).toHaveLength(0);
      }
      const onlyConfirm = await run(['--env', target, '--confirm', target], full);
      expect(onlyConfirm.output).toContain(`needs --confirm ${target} and --allow-main-domain`);
    });

    it(`${target}: with --confirm and --allow-main-domain → deploy is spawned`, async () => {
      const r = await run(['--env', target, '--confirm', target, '--allow-main-domain'], full);
      expect(r.code).toBe(0);
      expect(r.calls[0]?.args.slice(1, 4)).toEqual(['deploy', '--env', target]);
    });
  }

  it('rehearsal needs only --confirm', async () => {
    const r = await run(['--env', 'rehearsal', '--confirm', 'rehearsal'], full);
    expect(r.code).toBe(0);
    expect(r.calls[0]?.args.slice(1, 4)).toEqual(['deploy', '--env', 'rehearsal']);
  });
});
