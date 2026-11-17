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

type CfOpts = { bindings?: object[]; records?: object[]; bindingsStatus?: number; recordsStatus?: number };

/** Fake Cloudflare API for the holder check (F1): no network. */
function fakeCf(o: CfOpts = {}) {
  const urls: string[] = [];
  const reply = (status: number, result: object[]) =>
    status === 200 ? Response.json({ success: true, result }) : Response.json({ success: false, errors: [{ code: 9109 }] }, { status });
  const fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/workers/domains')) return reply(o.bindingsStatus ?? 200, o.bindings ?? []);
    if (u.includes('/dns_records')) return reply(o.recordsStatus ?? 200, o.records ?? []);
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

async function run(argv: string[], env: Record<string, string>, dir = assetsDir, cf = fakeCf()) {
  const calls: Call[] = [];
  let output = '';
  const code = (await deploy(argv, {
    spawn: fakeSpawn(calls),
    env,
    assetsDir: dir,
    fetch: cf.fetch,
    out: (s: string) => (output += s),
    err: (s: string) => (output += s),
  })) as number;
  return { code, calls, output, cfUrls: cf.urls };
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
      CLOUDFLARE_ZONE_ID: 'zone1',
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
  });
});

describe('main-domain double flag (AC-21)', () => {
  const full = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_ZONE_ID: 'zone1', T2F_EDGE_SECRET: SECRET };

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

describe('main-domain holder check before wrangler deploy (F1)', () => {
  const full = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_ZONE_ID: 'zone1', T2F_EDGE_SECRET: SECRET };
  const PRE = ['--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain'];
  const PROD = ['--env', 'production', '--confirm', 'production', '--allow-main-domain'];
  const OLD_SITE = { name: 'time2fest.com', type: 'A', content: '203.0.113.50', meta: {} };
  const PRELAUNCH_BINDING = { id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-prelaunch' };

  it('reads the bindings and the zone records of every route host', async () => {
    const r = await run(PROD, full);
    expect(r.code).toBe(0);
    expect(r.cfUrls).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/acct/workers/domains?hostname=time2fest.com',
      'https://api.cloudflare.com/client/v4/zones/zone1/dns_records?name=time2fest.com&per_page=100',
    ]);
  });

  it('a name bound to another Worker → 2, no spawn; --take-domain-from that Worker → deployed', async () => {
    const cf = { bindings: [PRELAUNCH_BINDING], records: [{ name: 'time2fest.com', type: 'AAAA', content: '100::', meta: { read_only: true } }] };
    const refused = await run(PROD, full, assetsDir, fakeCf(cf));
    expect(refused.code).toBe(2);
    expect(refused.calls).toHaveLength(0);
    expect(refused.output).toContain('t2f-edge-prelaunch');
    const wrong = await run([...PROD, '--take-domain-from', 'dns'], full, assetsDir, fakeCf(cf));
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(0);
    const ok = await run([...PROD, '--take-domain-from', 't2f-edge-prelaunch'], full, assetsDir, fakeCf(cf));
    expect(ok.code).toBe(0);
    expect(ok.calls[0]?.args.slice(1, 4)).toEqual(['deploy', '--env', 'production']);
  });

  it('the same Worker already holding the name → deployed without a flag', async () => {
    const r = await run(PRE, full, assetsDir, fakeCf({ bindings: [PRELAUNCH_BINDING] }));
    expect(r.code).toBe(0);
  });

  it('a non-Worker apex record (old site) → 2; only --take-domain-from dns lets it through', async () => {
    const refused = await run(PRE, full, assetsDir, fakeCf({ records: [OLD_SITE, { name: 'time2fest.com', type: 'MX', content: 'mx' }] }));
    expect(refused.code).toBe(2);
    expect(refused.calls).toHaveLength(0);
    const ok = await run([...PRE, '--take-domain-from', 'dns'], full, assetsDir, fakeCf({ records: [OLD_SITE] }));
    expect(ok.code).toBe(0);
    expect(ok.output).toContain('taking the name from dns');
  });

  it('--take-domain-from on a free name → 2 (it does not name the holder)', async () => {
    const r = await run([...PRE, '--take-domain-from', 'dns'], full);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('no CLOUDFLARE_ZONE_ID → 2 naming it, no request, no spawn', async () => {
    const { CLOUDFLARE_ZONE_ID: _z, ...noZone } = full;
    const r = await run(PRE, noZone);
    expect(r.code).toBe(2);
    expect(r.output).toContain('CLOUDFLARE_ZONE_ID');
    expect(r.cfUrls).toEqual([]);
    expect(r.calls).toHaveLength(0);
  });

  it('a token without the DNS-read right → 2 naming the right; never skipped', async () => {
    const r = await run(PRE, full, assetsDir, fakeCf({ recordsStatus: 403 }));
    expect(r.code).toBe(2);
    expect(r.output).toContain('DNS > Read');
    expect(r.calls).toHaveLength(0);
    const w = await run(PRE, full, assetsDir, fakeCf({ bindingsStatus: 403 }));
    expect(w.code).toBe(2);
    expect(w.output).toContain('Workers Scripts > Read');
  });

  it('a malformed --take-domain-from → 2 before anything', async () => {
    const r = await run([...PRE, '--take-domain-from', 'a b'], full);
    expect(r.code).toBe(2);
    expect(r.cfUrls).toEqual([]);
  });

  it('rehearsal and test make no Cloudflare API call', async () => {
    const reh = await run(['--env', 'rehearsal', '--confirm', 'rehearsal'], full);
    const test = await run(['--env', 'test'], full);
    expect(reh.code).toBe(0);
    expect(test.code).toBe(0);
    expect([...reh.cfUrls, ...test.cfUrls]).toEqual([]);
  });
});
