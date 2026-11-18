/**
 * SPEC-13a AC-1, AC-2: the image's listen address and start script, and the in-image health probe's
 * argument and URL rules (no server needed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listenAddress } from '../../scripts/lib/listen.mjs';
import { isLocalHttpUrl, main, parseProbeArgs } from '../../scripts/health-probe.mjs';

const script = (name: string) => readFileSync(fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url)), 'utf8');

describe('listenAddress (AC-2)', () => {
  it('class test → loopback, whatever T2F_HOST says', () => {
    expect(listenAddress({ T2F_ENV: 'test', T2F_HOST: '0.0.0.0', T2F_SERVER_PORT: '4260' })).toEqual({ host: '127.0.0.1', port: 4260 });
    expect(listenAddress({ T2F_ENV: 'test', T2F_SERVER_PORT: '4260' })).toEqual({ host: '127.0.0.1', port: 4260 });
  });

  it('rehearsal 0.0.0.0:3000 → ok; production with a host name → ok', () => {
    expect(listenAddress({ T2F_ENV: 'rehearsal', T2F_HOST: '0.0.0.0', T2F_SERVER_PORT: '3000' })).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(listenAddress({ T2F_ENV: 'production', T2F_HOST: 'server', T2F_SERVER_PORT: '3000' })).toEqual({ host: 'server', port: 3000 });
  });

  it('missing or bad T2F_HOST outside class test → failing T2F_HOST', () => {
    expect(listenAddress({ T2F_ENV: 'rehearsal', T2F_SERVER_PORT: '3000' })).toEqual({ failing: ['T2F_HOST'] });
    for (const bad of ['', 'bad host', '-x', 'a_b', 'http://0.0.0.0']) {
      expect(listenAddress({ T2F_ENV: 'rehearsal', T2F_HOST: bad, T2F_SERVER_PORT: '3000' })).toEqual({ failing: ['T2F_HOST'] });
    }
    // No class at all is not `test`: it never falls back to loopback silently.
    expect(listenAddress({ T2F_SERVER_PORT: '3000' })).toEqual({ failing: ['T2F_HOST'] });
  });

  it('missing or out-of-range T2F_SERVER_PORT → failing T2F_SERVER_PORT', () => {
    expect(listenAddress({ T2F_ENV: 'rehearsal', T2F_HOST: '0.0.0.0' })).toEqual({ failing: ['T2F_SERVER_PORT'] });
    for (const bad of ['0', '65536', '30a', '-1', ' 3000']) {
      expect(listenAddress({ T2F_ENV: 'rehearsal', T2F_HOST: '0.0.0.0', T2F_SERVER_PORT: bad })).toEqual({ failing: ['T2F_SERVER_PORT'] });
    }
    expect(listenAddress({ T2F_ENV: 'rehearsal' })).toEqual({ failing: ['T2F_HOST', 'T2F_SERVER_PORT'] });
    expect(listenAddress({ T2F_ENV: 'test' })).toEqual({ failing: ['T2F_SERVER_PORT'] });
  });
});

describe('image-start.mjs (AC-1)', () => {
  const source = script('image-start.mjs');

  it('has no checkout lookup and no package manager: no worktree, git or pnpm', () => {
    expect(source).not.toMatch(/worktree|git|pnpm/i);
  });

  it('spawns without a shell, from a fixed argv', () => {
    expect(source).toMatch(/shell: false/);
    expect(source).not.toMatch(/shell: true|execSync|exec\(/);
  });
});

describe('health-probe.mjs', () => {
  it('URL rule: http:// to a single-label host or loopback only', () => {
    for (const ok of ['http://127.0.0.1:3000/api/health', 'http://server:3000/api/health', 'http://localhost:4260/api/health']) {
      expect(isLocalHttpUrl(ok)).toBe(true);
    }
    for (const bad of ['https://server:3000/api/health', 'http://o-rehearsal.time2fest.com/api/health', 'http://u:p@server/api/health', 'file:///etc/passwd', 'nope']) {
      expect(isLocalHttpUrl(bad)).toBe(false);
    }
  });

  it('arguments: unknown flag or secret mode → usage error', () => {
    expect(parseProbeArgs([])).toEqual({ secret: 'current', raw: false });
    expect(parseProbeArgs(['--secret', 'previous', '--raw'])).toEqual({ secret: 'previous', raw: true });
    expect(parseProbeArgs(['--secret', 'mine'])).toHaveProperty('error');
    expect(parseProbeArgs(['--bogus'])).toHaveProperty('error');
  });

  it('sends the current secret from its own env, prints `<status> <commit>` and never the secret; exit 0 only on 200', async () => {
    const secret = 'a'.repeat(48); // check-secrets: allow (fake)
    const commit = 'b'.repeat(40);
    const seen: (string | null)[] = [];
    const lines: string[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const value = new Headers(init?.headers).get('x-t2f-edge');
      seen.push(value);
      return value === secret
        ? new Response(JSON.stringify({ ok: true, commit }), { status: 200 })
        : new Response('{"ok":false}', { status: 404 });
    }) as typeof fetch;
    const deps = { env: { T2F_SERVER_PORT: '3000', T2F_EDGE_SECRET: secret }, out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), fetch: fakeFetch };

    expect(await main([], deps)).toBe(0);
    expect(await main(['--secret', 'wrong'], deps)).toBe(1);
    expect(await main(['--secret', 'none'], deps)).toBe(1);
    expect(lines).toEqual([`200 ${commit}`, '404 -', '404 -']);
    expect(seen[0]).toBe(secret);
    expect(seen[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[2]).toBeNull();
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('no answer → `000 -`, exit 1; a remote URL or no port → exit 2', async () => {
    const lines: string[] = [];
    const out = (s: string) => lines.push(s);
    const refused = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(await main([], { env: { T2F_SERVER_PORT: '3000' }, out, err: out, fetch: refused })).toBe(1);
    expect(lines).toEqual(['000 -']);
    expect(await main(['--url', 'https://rehearsal.time2fest.com/api/health'], { env: {}, out, err: out, fetch: refused })).toBe(2);
    expect(await main([], { env: {}, out, err: out, fetch: refused })).toBe(2);
  });
});
