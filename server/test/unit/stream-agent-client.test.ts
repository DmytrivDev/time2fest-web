/**
 * SPEC-21a AC-34, NFR-5: the stream agent's client reads only the four variables, sends the three headers,
 * reports only codes, and neither the client nor the agent files hold an address, a machine path or a key.
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_TOOLS, ENV_NAMES, PROMPT_FILE, buildRunArgv, main } from '../../scripts/stream-agent.mjs';

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

describe('run', () => {
  it('argv builder holds the prompt path and the allowed-tools list', () => {
    const argv: string[] = buildRunArgv();
    expect(argv[0]).toBe('-p');
    expect(argv.join(' ')).toContain(PROMPT_FILE);
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe(ALLOWED_TOOLS.join(','));
    expect(ALLOWED_TOOLS.some((t: string) => t.includes('propose'))).toBe(true);
  });

  it('spawns through the injected spawner and maps the exit code', async () => {
    let got: string[] = [];
    const spawnImpl = (a: string[]) => {
      got = a;
      return { on: (ev: string, cb: (c?: number) => void) => ev === 'close' && setTimeout(() => cb(0), 0) };
    };
    let out = '';
    const code = await main(['run'], fullEnv(), fetch, { out: (s: string) => (out += s), err: () => {}, spawnImpl });
    expect(code).toBe(0);
    expect(got).toEqual(buildRunArgv());
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
