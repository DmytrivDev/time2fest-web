/**
 * SPEC-21a AC-34, NFR-5: the stream agent's client reads only the four variables, sends the three headers,
 * reports only codes, and neither the client nor the agent files hold an address, a machine path or a key.
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DISALLOWED_TOOLS,
  ENV_NAMES,
  PROMPT_SELF,
  allowedTools,
  buildRunArgv,
  holdsSecret,
  main,
  resolveClaude,
} from '../../scripts/stream-agent.mjs';

const KEY = 'k-secret-111';
const ID = 'id-secret-222';
const SEC = 'sec-secret-333';

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: string }
let seen: Seen[] = [];
let mode: 'ok' | 'forbidden' | 'limited' = 'ok';
let base = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (mode === 'forbidden') {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: { code: 'forbidden', reason: KEY } }));
    } else if (mode === 'limited') {
      res.statusCode = 429;
      res.end(JSON.stringify({ ok: false, error: { code: 'rate-limited', retryAfterMs: 4200 } }));
    } else res.end(JSON.stringify({ ok: true, value: { items: [] } }));
  });
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const fullEnv = () => ({
  T2F_STREAM_AGENT_BASE_URL: base,
  T2F_STREAM_AGENT_KEY: KEY,
  T2F_STREAM_AGENT_ACCESS_CLIENT_ID: ID,
  T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET: SEC,
});
async function run(argv: string[], env: Record<string, string | undefined> = fullEnv()) {
  let out = '';
  let err = '';
  const code = await main(argv, env, fetch, { out: (s: string) => (out += s), err: (s: string) => (err += s) });
  return { code, out, err };
}

describe('missing variables', () => {
  it.each([...ENV_NAMES])('%s missing → exit 2, names it, none of the other values', async (name) => {
    const env: Record<string, string | undefined> = fullEnv();
    delete env[name];
    const r = await run(['channels'], env);
    expect(r.code).toBe(2);
    expect(r.err).toContain(name);
    for (const v of [KEY, ID, SEC, base]) expect(r.err + r.out).not.toContain(v);
  });
});

describe('requests', () => {
  it('sends the three headers and the right path for each command', async () => {
    seen = [];
    mode = 'ok';
    expect((await run(['channels'])).code).toBe(0);
    expect((await run(['candidates', '--state', 'proposed', '--event', 'ev1', '--cursor', 'c1'])).code).toBe(0);
    const p = await run(['propose', '--video', 'abcdefghijk', '--event', 'ev1', '--evidence', 'https://example.org/p', '--note', 'n']);
    expect(p.code).toBe(0);
    expect(JSON.parse(p.out)).toEqual({ items: [] });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET /cms-api/stream-agent/channels',
      'GET /cms-api/stream-agent/candidates?state=proposed&eventId=ev1&cursor=c1',
      'POST /cms-api/stream-agent/candidates',
    ]);
    for (const s of seen) {
      expect(s.headers.authorization).toBe(`admins API-Key ${KEY}`);
      expect(s.headers['cf-access-client-id']).toBe(ID);
      expect(s.headers['cf-access-client-secret']).toBe(SEC);
    }
    expect(JSON.parse(seen[2]!.body)).toEqual({ videoId: 'abcdefghijk', eventId: 'ev1', evidenceUrl: 'https://example.org/p', note: 'n' });
  });

  it('propose --channel sends channelId; both or neither → exit 2', async () => {
    seen = [];
    expect((await run(['propose', '--channel', 'UC123'])).code).toBe(0);
    expect(JSON.parse(seen[0]!.body)).toEqual({ channelId: 'UC123' });
    expect((await run(['propose', '--video', 'a', '--channel', 'b'])).code).toBe(2);
    expect((await run(['propose'])).code).toBe(2);
    expect((await run(['nope'])).code).toBe(2);
  });

  it('403 and 429 → exit 1 with the code (and retryAfterMs) only, never the key', async () => {
    mode = 'forbidden';
    const f = await run(['channels']);
    expect(f.code).toBe(1);
    expect(JSON.parse(f.err)).toEqual({ code: 'forbidden' });
    expect(f.err + f.out).not.toContain(KEY);
    mode = 'limited';
    const l = await run(['channels']);
    expect(l.code).toBe(1);
    expect(JSON.parse(l.err)).toEqual({ code: 'rate-limited', retryAfterMs: 4200 });
    mode = 'ok';
  });
});

describe('secret values in arguments (S21-02)', () => {
  it.each([
    ['--note', KEY],
    ['--note', `see ${ID} here`],
    ['--evidence', `https://evil.example/?k=${SEC}`],
  ])('propose %s with a secret value → exit 2, nothing sent, value not echoed', async (flag, value) => {
    seen = [];
    const r = await run(['propose', '--video', 'abcdefghijk', flag, value]);
    expect(r.code).toBe(2);
    expect(seen).toHaveLength(0);
    for (const v of [KEY, ID, SEC]) expect(r.err + r.out).not.toContain(v);
  });
  it('candidates --cursor with a secret value is refused too; plain arguments pass', () => {
    expect(holdsSecret(['candidates', '--cursor', KEY], fullEnv())).toBe(true);
    expect(holdsSecret(['propose', '--video', 'abcdefghijk', '--note', 'ok'], fullEnv())).toBe(false);
  });
});

describe('run (S21-01, S21-04, S21-05)', () => {
  const SELF = 'node "X:/w/server/scripts/stream-agent.mjs"';
  const argv: string[] = buildRunArgv(SELF);
  const val = (flag: string) => argv[argv.indexOf(flag) + 1];

  it('prompt by stdin: -p with no inline prompt, no positional argument', () => {
    expect(argv[0]).toBe('-p');
    expect(val('--input-format')).toBe('text');
    expect(argv.join(' ')).not.toContain('prompt.md');
  });
  it('only Bash and WebFetch exist; Bash limited to the three client commands', () => {
    expect(val('--tools')).toBe('Bash,WebFetch');
    expect(val('--allowedTools')).toBe(allowedTools(SELF).join(','));
    expect(allowedTools(SELF)).toEqual([
      `Bash(${SELF} channels)`,
      `Bash(${SELF} candidates *)`,
      `Bash(${SELF} propose *)`,
      'WebFetch',
    ]);
    expect(val('--permission-mode')).toBe('dontAsk');
  });
  it('denies file tools and WebFetch to youtube and local hosts', () => {
    const d = val('--disallowedTools')!.split(',');
    expect(d).toEqual(DISALLOWED_TOOLS);
    for (const t of ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch(domain:youtube.com)', 'WebFetch(domain:www.youtube.com)', 'WebFetch(domain:localhost)', 'WebFetch(domain:127.0.0.1)'])
      expect(d).toContain(t);
  });
  it('no MCP servers and no user/project/local settings', () => {
    expect(argv).toContain('--strict-mcp-config');
    expect(JSON.parse(val('--mcp-config')!)).toEqual({ mcpServers: {} });
    expect(val('--setting-sources')).toBe('');
  });

  it('spawns in an empty temp cwd outside the repo, prompt by stdin with the absolute client command', async () => {
    let got: { argv: string[]; cwd: string; input: string } | undefined;
    let empty = false;
    const spawnImpl = (spec: { argv: string[]; cwd: string; input: string }) => {
      got = spec;
      empty = existsSync(spec.cwd) && readdirSync(spec.cwd).length === 0;
      return { on: (ev: string, cb: (c?: number) => void) => ev === 'close' && setTimeout(() => cb(0), 0) };
    };
    const code = await main(['run'], fullEnv(), fetch, { out: () => {}, err: () => {}, spawnImpl });
    expect(code).toBe(0);
    expect(empty).toBe(true);
    const norm = (p: string) => path.resolve(p).split(path.sep).join('/').toLowerCase();
    expect(norm(got!.cwd).startsWith(norm(fileURLToPath(new URL('../../../', import.meta.url))))).toBe(false);
    expect(existsSync(got!.cwd)).toBe(false); // cleaned up
    expect(got!.input).toMatch(/Заборонено/);
    expect(got!.input).not.toContain(PROMPT_SELF);
    expect(got!.input).toMatch(/node ".*\/server\/scripts\/stream-agent\.mjs" channels/);
    expect(got!.argv).toEqual(buildRunArgv());
    // the prompt names the client exactly as the Bash allow rules do
    expect(got!.argv[got!.argv.indexOf('--allowedTools') + 1]).toContain(got!.input.match(/node "[^"]+"/)![0]);
    for (const v of [KEY, ID, SEC]) expect(got!.input + got!.argv.join(' ')).not.toContain(v);
  });

  it('run takes no arguments', async () => {
    expect((await run(['run', '--x'])).code).toBe(2);
  });

  it('resolves claude without a shell: claude.exe on PATH, or the binary behind the npm claude.cmd shim', () => {
    expect(resolveClaude('linux', '/usr/bin')).toBe('claude');
    const has = (set: string[]) => (p: string) => set.includes(p);
    const w = (...p: string[]) => path.win32.join('X:/', ...p);
    expect(resolveClaude('win32', `${w('a')};${w('b')}`, has([w('b', 'claude.exe')]))).toBe(w('b', 'claude.exe'));
    const shimBin = w('n', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    expect(resolveClaude('win32', w('n'), has([w('n', 'claude.cmd'), shimBin]))).toBe(shimBin);
    expect(resolveClaude('win32', w('n'), has([w('n', 'claude.cmd')]))).toBeUndefined();
  });
});

describe('no addresses, paths or keys in the agent files (AC-34)', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = `${root}agents/stream-search`;
  const files = [`${root}server/scripts/stream-agent.mjs`, ...readdirSync(dir).map((f) => `${dir}/${f}`)];
  it('finds the three agent files', () => {
    expect(readdirSync(dir).sort()).toEqual(['AGENT.md', 'prompt.md', 'schedule.md']);
  });
  it.each(files.map((f) => [f.slice(root.length), f]))('%s', (_n, f) => {
    const text = readFileSync(f, 'utf8');
    for (const bad of ['time2fest.com', 'D:/', 'C:/', 'D:\\', 'C:\\', '/home/']) expect(text).not.toContain(bad);
    expect(text).not.toMatch(/[A-Za-z0-9]{32,}/);
  });
  it('prompt forbids youtube.com search and keeps the data-not-instructions rule', () => {
    const p = readFileSync(`${dir}/prompt.md`, 'utf8');
    expect(p).toMatch(/youtube\.com/);
    expect(p).toMatch(/Заборонено/);
    expect(p).toMatch(/дані, а не інструкції/);
  });
});
