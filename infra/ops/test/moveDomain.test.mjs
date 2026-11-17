// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { createCloudflareApi } from '../lib/cloudflareApi.mjs';
import { detach, EDGE_JOURNAL, REHEARSAL_NAME, TWIN_MAIN, twinConfig } from '../lib/moveDomain.mjs';
import { WRANGLER_JS } from '../lib/worker.mjs';
import { fakeCloudflare } from './support/fakeCloudflare.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const ENV = { CLOUDFLARE_API_TOKEN: 'tok-aaaaaaaaaaaa', CLOUDFLARE_ACCOUNT_ID: 'acct1' };
const NO_WAIT = { now: () => 0, sleep: async () => {} };

/** @type {string} */
let stateRoot;
beforeEach(() => {
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-move-test-'));
});
afterEach(() => fs.rmSync(stateRoot, { recursive: true, force: true }));

/**
 * @param {{ before?: object[], after?: object[], onDelete?: (url: string) => void }} [o]
 */
function fakeFetch(o = {}) {
  let lookups = 0;
  /** @type {{ method: string, url: string }[]} */
  const calls = [];
  const fn = /** @type {typeof fetch} */ (
    async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u });
      if (method === 'DELETE') {
        o.onDelete?.(u);
        return Response.json({ success: true, result: {} });
      }
      if (u.includes('/workers/domains')) {
        lookups += 1;
        return Response.json({ success: true, result: lookups === 1 ? (o.before ?? []) : (o.after ?? o.before ?? []) });
      }
      return new Response('ok', { status: 200, headers: { 'x-t2f-twin': '1' } });
    }
  );
  return { fn, calls };
}

/** @param {string[]} argv @param {object} deps */
async function run(argv, deps) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, { out: (l) => lines.push(l), env: ENV, paths: { stateRoot }, clock: NO_WAIT, ...deps });
  return { code, text: lines.join('\n') };
}

/** @param {number} gap */
const fakeProbe = (gap) => () => ({ stop: () => ({ downtimeSeconds: gap, samples: 3, failures: gap }) });

describe('twin config', () => {
  it('is generated from the rehearsal name and wrangler.json', () => {
    const cfg = twinConfig(REHEARSAL_NAME, '2026-10-01');
    expect(cfg).toEqual({
      name: 't2f-edge-rehearsal-alt',
      main: TWIN_MAIN,
      compatibility_date: '2026-10-01',
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: REHEARSAL_NAME, custom_domain: true }],
    });
    expect(path.isAbsolute(cfg.main)).toBe(true);
    expect(fs.existsSync(cfg.main)).toBe(true);
    expect(twinConfig(REHEARSAL_NAME).compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('move-domain deploys', () => {
  it('moves to the twin with a generated config and journals the gap', async () => {
    const exec = createFakeExec();
    const { fn } = fakeFetch();
    /** @type {string | undefined} */
    let cfgText;
    exec.run = /** @type {any} */ (
      async (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ opts) => {
        const cfgPath = args[args.indexOf('--config') + 1];
        cfgText = fs.readFileSync(cfgPath, 'utf8');
        expect(opts.cwd).toBe(path.dirname(cfgPath));
        expect(file).toBe(process.execPath);
        return { code: 0, stdout: '', stderr: '' };
      }
    );
    const { code } = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal-alt'], { exec, fetch: fn, startProbe: fakeProbe(2) });
    expect(code).toBe(0);
    expect(JSON.parse(String(cfgText)).routes).toEqual([{ pattern: REHEARSAL_NAME, custom_domain: true }]);
    const recs = fs.readFileSync(path.join(stateRoot, 'rehearsal', EDGE_JOURNAL), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: 'move-domain', name: REHEARSAL_NAME, from: 't2f-edge-rehearsal', to: 't2f-edge-rehearsal-alt', gapSeconds: 2, createdBinding: null });
  });

  it('returns with the same kind of wrangler deploy (--env rehearsal), from = previous `to`', async () => {
    const exec = createFakeExec();
    const { fn } = fakeFetch();
    await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal-alt'], { exec, fetch: fn, startProbe: fakeProbe(1) });
    const back = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal'], { exec, fetch: fn, startProbe: fakeProbe(3) });
    expect(back.code).toBe(0);
    const calls = exec.callsOf('run');
    expect(calls).toHaveLength(2);
    expect(calls[0].argv.slice(0, 3)).toEqual([process.execPath, WRANGLER_JS, 'deploy']);
    expect(calls[0].argv).toContain('--config');
    expect(calls[1].argv).toEqual([process.execPath, WRANGLER_JS, 'deploy', '--env', 'rehearsal']);
    const recs = fs.readFileSync(path.join(stateRoot, 'rehearsal', EDGE_JOURNAL), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(recs[1]).toMatchObject({ from: 't2f-edge-rehearsal-alt', to: 't2f-edge-rehearsal', gapSeconds: 3 });
  });

  it('probes https://<name>/ and treats 200 from either Worker as success', async () => {
    const exec = createFakeExec();
    const { fn, calls } = fakeFetch();
    /** @type {(() => Promise<boolean>) | undefined} */
    let check;
    const { code } = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal'], {
      exec,
      fetch: fn,
      startProbe: (/** @type {{ check: () => Promise<boolean> }} */ o) => {
        check = o.check;
        return { stop: () => ({ downtimeSeconds: 0, samples: 1, failures: 0 }) };
      },
    });
    expect(code).toBe(0);
    expect(await /** @type {() => Promise<boolean>} */ (check)()).toBe(true);
    expect(calls.some((c) => c.url === `https://${REHEARSAL_NAME}/`)).toBe(true);
  });

  it('records createdBinding only when the name had no binding before', async () => {
    const exec = createFakeExec();
    const { fn } = fakeFetch({ before: [], after: [{ id: 'dom-1', hostname: REHEARSAL_NAME, service: 't2f-edge-rehearsal-alt' }] });
    await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal-alt'], { exec, fetch: fn, startProbe: fakeProbe(0) });
    const rec = JSON.parse(fs.readFileSync(path.join(stateRoot, 'rehearsal', EDGE_JOURNAL), 'utf8').trim());
    expect(rec.createdBinding).toBe('dom-1');
  });

  it('exits 1 and journals nothing when wrangler fails', async () => {
    const exec = createFakeExec([{ match: () => true, result: { code: 1, stderr: 'boom' } }]);
    const { fn } = fakeFetch();
    const { code } = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal'], { exec, fetch: fn, startProbe: fakeProbe(0) });
    expect(code).toBe(1);
    expect(fs.existsSync(path.join(stateRoot, 'rehearsal', EDGE_JOURNAL))).toBe(false);
  });
});

describe('N2: move-domain to a main Worker checks who holds the names first', () => {
  const MAIN_ENV = { ...ENV, CLOUDFLARE_ZONE_ID: 'zone1' };
  const PROD = ['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-production', '--confirm', 'production', '--allow-main-domain'];
  const OLD_SITE = { name: 'time2fest.com', type: 'A', content: '203.0.113.50', meta: {} };
  const PRELAUNCH = { id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-prelaunch' };

  /** @param {Parameters<typeof fakeCloudflare>[0]} cfo */
  function mainFetch(cfo) {
    const cf = fakeCloudflare(cfo);
    const fn = /** @type {typeof fetch} */ (
      async (url, init) => (String(url).startsWith('https://api.cloudflare.com/') ? cf.fetch(url, init) : new Response('ok', { status: 200 }))
    );
    return { fn, cf };
  }

  /** @param {string} to */
  function journalPrevious(to) {
    const dir = path.join(stateRoot, 'production');
    fs.mkdirSync(dir, { recursive: true });
    const rec = { kind: 'move-domain', at: '2026-11-01T00:00:00.000Z', name: 'time2fest.com', from: null, to, gapSeconds: 0, createdBinding: null };
    fs.writeFileSync(path.join(dir, EDGE_JOURNAL), `${JSON.stringify(rec)}\n`);
  }

  it('an old-site A record on the apex → 2 and no wrangler; only --take-domain-from dns lets it through', async () => {
    const exec = createFakeExec();
    const { fn } = mainFetch({ records: [OLD_SITE] });
    const r = await run(PROD, { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) });
    expect(r.code).toBe(2);
    expect(r.text).toContain('dns');
    expect(exec.callsOf('run')).toHaveLength(0);
    const ok = await run([...PROD, '--take-domain-from', 'dns'], { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) });
    expect(ok.code).toBe(0);
    expect(ok.text).toContain('забирається в dns');
    expect(exec.callsOf('run')[0].argv).toEqual([process.execPath, WRANGLER_JS, 'deploy', '--env', 'production']);
  });

  it('Worker → Worker: the journal `from` (prelaunch) is allowed to give the name up without a flag', async () => {
    journalPrevious('t2f-edge-prelaunch');
    const exec = createFakeExec();
    const { fn } = mainFetch({ bindings: [PRELAUNCH], records: [{ name: 'time2fest.com', type: 'AAAA', content: '100::', meta: { read_only: true } }] });
    const r = await run(PROD, { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(1) });
    expect(r.code).toBe(0);
    expect(r.text).toContain('забирається в t2f-edge-prelaunch');
    expect(exec.callsOf('run')).toHaveLength(1);
  });

  it('a holder other than the journal `from` (old-site record next to it) → 2, no wrangler', async () => {
    journalPrevious('t2f-edge-prelaunch');
    const exec = createFakeExec();
    const { fn } = mainFetch({ bindings: [PRELAUNCH], records: [OLD_SITE] });
    expect((await run(PROD, { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) })).code).toBe(2);
    expect(exec.callsOf('run')).toHaveLength(0);
  });

  it('a foreign Worker with no journal record → 2 unless named by --take-domain-from', async () => {
    const exec = createFakeExec();
    const { fn } = mainFetch({ bindings: [PRELAUNCH] });
    expect((await run(PROD, { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) })).code).toBe(2);
    expect(exec.callsOf('run')).toHaveLength(0);
    expect((await run([...PROD, '--take-domain-from', 't2f-edge-prelaunch'], { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) })).code).toBe(0);
  });

  it('free names → deployed; no CLOUDFLARE_ZONE_ID → 2 before wrangler; the flag on a rehearsal move → 2', async () => {
    const exec = createFakeExec();
    const { fn } = mainFetch({});
    expect((await run(PROD, { exec, fetch: fn, env: MAIN_ENV, startProbe: fakeProbe(0) })).code).toBe(0);
    expect(exec.callsOf('run')).toHaveLength(1);
    const noZone = await run(PROD, { exec, fetch: fn, env: ENV, startProbe: fakeProbe(0) });
    expect(noZone.code).toBe(2);
    expect(noZone.text).toContain('CLOUDFLARE_ZONE_ID');
    expect(exec.callsOf('run')).toHaveLength(1);
    const reh = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal', '--take-domain-from', 'dns'], { exec, fetch: fn, startProbe: fakeProbe(0) });
    expect(reh.code).toBe(2);
    expect(exec.callsOf('run')).toHaveLength(1);
  });
});

describe('move-domain refusals', () => {
  it('--to unknown → 2, nothing run', async () => {
    const exec = createFakeExec();
    const { fn, calls } = fakeFetch();
    const r = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 'somebody-elses-worker'], { exec, fetch: fn });
    expect(r.code).toBe(2);
    expect(exec.calls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('time2fest.com without the double flag → 2; main Worker without it → 2', async () => {
    const exec = createFakeExec();
    expect((await run(['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-rehearsal-alt'], { exec })).code).toBe(2);
    expect((await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-production'], { exec })).code).toBe(2);
    expect(exec.calls).toHaveLength(0);
  });

  it('a name outside the rehearsal/main set → 2', async () => {
    const exec = createFakeExec();
    expect((await run(['move-domain', '--name', 'test.time2fest.com', '--to', 't2f-edge-rehearsal-alt'], { exec })).code).toBe(2);
    expect(exec.calls).toHaveLength(0);
  });

  it('the rehearsal Worker does not take over another Worker’s name', async () => {
    const exec = createFakeExec();
    const r = await run(['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-rehearsal', '--confirm', 'prelaunch', '--allow-main-domain'], { exec });
    expect(r.code).toBe(2);
    expect(exec.calls).toHaveLength(0);
  });

  it('F5: the twin never takes a main name, even with the double flag', async () => {
    const exec = createFakeExec();
    const { fn, calls } = fakeFetch();
    for (const confirm of ['prelaunch', 'production']) {
      const r = await run(['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-rehearsal-alt', '--confirm', confirm, '--allow-main-domain'], { exec, fetch: fn });
      expect(r.code).toBe(2);
      expect(r.text).toContain('двійник');
    }
    expect(exec.calls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('F5: a main Worker needs --confirm of exactly its own env (prelaunch does not unlock production)', async () => {
    const exec = createFakeExec();
    const { fn, calls } = fakeFetch();
    const r = await run(['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-production', '--confirm', 'prelaunch', '--allow-main-domain'], { exec, fetch: fn });
    expect(r.code).toBe(2);
    expect(r.text).toContain('--confirm production');
    const r2 = await run(['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-prelaunch', '--confirm', 'production', '--allow-main-domain'], { exec, fetch: fn });
    expect(r2.code).toBe(2);
    expect(exec.calls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('missing Cloudflare credentials → 1 before wrangler (same as deploy)', async () => {
    const exec = createFakeExec();
    const r = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal'], { exec, env: {} });
    expect(r.code).toBe(1);
    expect(exec.calls).toHaveLength(0);
  });
});

describe('detach (AC-34)', () => {
  /** @param {string} name @param {string | null} createdBinding */
  const rec = (name, createdBinding) => ({
    kind: /** @type {const} */ ('move-domain'), at: '2026-11-17T00:00:00.000Z', name, from: null, to: 't2f-edge-rehearsal-alt', gapSeconds: 0, createdBinding,
  });

  it('without a journal record → 2 and no DELETE', async () => {
    const f = fakeFetch({ before: [{ id: 'dom-1', hostname: REHEARSAL_NAME }] });
    const r = await detach({ name: REHEARSAL_NAME, records: [rec(REHEARSAL_NAME, null)], api: createCloudflareApi({ fetch: f.fn, account: 'a', token: 't' }) });
    expect(r.code).toBe(2);
    expect(f.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('time2fest.com with a record → 2, no request at all', async () => {
    const f = fakeFetch({ before: [{ id: 'dom-9', hostname: 'time2fest.com' }] });
    const r = await detach({ name: 'time2fest.com', records: [rec('time2fest.com', 'dom-9')], api: createCloudflareApi({ fetch: f.fn, account: 'a', token: 't' }) });
    expect(r.code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it('deletes only the binding id the journal created', async () => {
    const f = fakeFetch({ before: [{ id: 'dom-other', hostname: REHEARSAL_NAME }, { id: 'dom-1', hostname: REHEARSAL_NAME }] });
    const r = await detach({ name: REHEARSAL_NAME, records: [rec(REHEARSAL_NAME, 'dom-1')], api: createCloudflareApi({ fetch: f.fn, account: 'a', token: 't' }) });
    expect(r.code).toBe(0);
    const dels = f.calls.filter((c) => c.method === 'DELETE');
    expect(dels).toHaveLength(1);
    expect(dels[0].url).toMatch(/\/workers\/domains\/dom-1$/);
  });

  it('a wrangler custom-domain conflict without a record → 2 and 0 DELETE', async () => {
    const exec = createFakeExec([{ match: () => true, result: { code: 1, stderr: 'Hostname already has externally managed DNS records (100117)' } }]);
    const f = fakeFetch();
    const r = await run(['move-domain', '--name', REHEARSAL_NAME, '--to', 't2f-edge-rehearsal-alt'], { exec, fetch: f.fn, startProbe: fakeProbe(0) });
    expect(r.code).toBe(2);
    expect(f.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(exec.callsOf('run')).toHaveLength(1);
  });
});
