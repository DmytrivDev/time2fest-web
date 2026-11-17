// @ts-check
// F1: перед `wrangler deploy` робочого домену — хто тримає ім’я (прив’язки Custom Domain і записи DNS). Фейковий API.
import { describe, expect, it } from 'vitest';
import { createCloudflareApi } from '../lib/cloudflareApi.mjs';
import { checkDomainHolders, RIGHT_DNS_READ, RIGHT_WORKERS_READ } from '../lib/domainHolder.mjs';
import { parseArgs } from '../lib/args.mjs';
import { fakeCloudflare } from './support/fakeCloudflare.mjs';

const HOSTS = ['time2fest.com'];
const SELF = 't2f-edge-production';
const OLD_SITE = { name: 'time2fest.com', type: 'A', content: '203.0.113.50', meta: {} };
const WORKER_REC = { name: 'time2fest.com', type: 'AAAA', content: '100::', meta: { read_only: true } };
const MX = { name: 'time2fest.com', type: 'MX', content: 'mx.example.org', meta: {} };

/** @param {Parameters<typeof fakeCloudflare>[0]} o @param {string | null} [zone] */
function api(o, zone = 'zone1') {
  const cf = fakeCloudflare(o);
  return { cf, api: createCloudflareApi({ fetch: cf.fetch, account: 'acct1', token: 'tok-aaaaaaaa', zone }) };
}

describe('checkDomainHolders', () => {
  it('a free name (only MX/TXT, no binding) → ok, reads both bindings and zone records', async () => {
    const { cf, api: a } = api({ records: [MX] });
    expect(await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF })).toEqual({ ok: true, taken: [] });
    expect(cf.calls.map((c) => c.url)).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/acct1/workers/domains?hostname=time2fest.com',
      'https://api.cloudflare.com/client/v4/zones/zone1/dns_records?name=time2fest.com&per_page=100',
    ]);
  });

  it('the name already bound to this same Worker → ok', async () => {
    const { api: a } = api({ bindings: [{ id: 'd1', hostname: 'time2fest.com', service: SELF }], records: [WORKER_REC] });
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF })).ok).toBe(true);
  });

  it('bound to a different Worker (prelaunch) → 2, naming the holder', async () => {
    const { api: a } = api({ bindings: [{ id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-prelaunch' }], records: [WORKER_REC] });
    const r = await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(/** @type {{ message: string }} */ (r).message).toContain('t2f-edge-prelaunch');
  });

  it('…unless --take-domain-from names exactly that Worker', async () => {
    const { api: a } = api({ bindings: [{ id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-prelaunch' }], records: [WORKER_REC] });
    expect(await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF, takeFrom: 't2f-edge-prelaunch' })).toEqual({ ok: true, taken: ['t2f-edge-prelaunch'] });
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF, takeFrom: 'dns' })).ok).toBe(false);
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF, takeFrom: 't2f-edge-rehearsal' })).ok).toBe(false);
  });

  it('a non-Worker A/AAAA/CNAME record (the old site) → 2; only --take-domain-from dns lets it through', async () => {
    const { api: a } = api({ records: [OLD_SITE, MX] });
    const r = await checkDomainHolders({ api: a, hosts: HOSTS, worker: 't2f-edge-prelaunch' });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(/** @type {{ message: string }} */ (r).message).toContain('dns');
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: 't2f-edge-prelaunch', takeFrom: 't2f-edge-production' })).ok).toBe(false);
    expect(await checkDomainHolders({ api: a, hosts: HOSTS, worker: 't2f-edge-prelaunch', takeFrom: 'dns' })).toEqual({ ok: true, taken: ['dns'] });
  });

  it('both a foreign Worker and a DNS record → 2 even with a flag (the flag names one holder only)', async () => {
    const { api: a } = api({ bindings: [{ id: 'd1', hostname: 'time2fest.com', service: 't2f-edge-prelaunch' }], records: [OLD_SITE] });
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF, takeFrom: 't2f-edge-prelaunch' })).ok).toBe(false);
  });

  it('--take-domain-from on a free name → 2 (the flag does not name the current holder)', async () => {
    const { api: a } = api({});
    expect((await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF, takeFrom: 'dns' })).ok).toBe(false);
  });

  it('no zone id → 2 naming CLOUDFLARE_ZONE_ID, no request', async () => {
    const { cf, api: a } = api({}, null);
    const r = await checkDomainHolders({ api: a, hosts: HOSTS, worker: SELF });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(/** @type {{ message: string }} */ (r).message).toContain('CLOUDFLARE_ZONE_ID');
    expect(cf.calls).toEqual([]);
  });

  it('a token without the DNS-read or Workers-read right → 2 naming the missing right (never skipped)', async () => {
    const dns = await checkDomainHolders({ api: api({ recordsStatus: 403 }).api, hosts: HOSTS, worker: SELF });
    expect(dns).toMatchObject({ ok: false, code: 2 });
    expect(/** @type {{ message: string }} */ (dns).message).toContain(RIGHT_DNS_READ);
    const wk = await checkDomainHolders({ api: api({ bindingsStatus: 403 }).api, hosts: HOSTS, worker: SELF });
    expect(/** @type {{ message: string }} */ (wk).message).toContain(RIGHT_WORKERS_READ);
    const other = await checkDomainHolders({ api: api({ recordsStatus: 500 }).api, hosts: HOSTS, worker: SELF });
    expect(other).toMatchObject({ ok: false, code: 2 });
  });
});

describe('--take-domain-from parsing', () => {
  it('accepts dns or a Worker name for deploy only', () => {
    expect(parseArgs('deploy', ['--env', 'production', '--take-domain-from', 'DNS']).ok).toBe(true);
    expect(parseArgs('deploy', ['--env', 'production', '--take-domain-from', 't2f-edge-prelaunch']).ok).toBe(true);
    expect(parseArgs('deploy', ['--env', 'production', '--take-domain-from', 'a b']).ok).toBe(false);
    expect(parseArgs('rollback', ['--env', 'production', '--take-domain-from', 'dns']).ok).toBe(false);
  });
});
