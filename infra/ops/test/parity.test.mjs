// @ts-check
// Паритет копій правил між пакетами: ops, infra/cloudflare і розгортання Worker’а мають однакові хости робочого
// домену й однаковий перелік середовищ робочого домену. Копії живуть окремо (пакети без спільної залежності),
// тож рівність тримає цей тест. Перевірка тримача імені (A1) продубльована в `workers/edge/scripts/deploy.mjs`:
// обидві копії проходять ті самі сценарії фейкового Cloudflare API і мають давати однакові `ok`/`taken`.
import { describe, expect, it } from 'vitest';
import { MAIN_HOSTS as CF_MAIN_HOSTS } from '../../cloudflare/lib/config.mjs';
import {
  ADDRESS_TYPES as EDGE_ADDRESS_TYPES,
  checkDomainHolders as edgeCheckDomainHolders,
  MAIN_DOMAIN_ENVS,
  TAKE_FROM_DNS as EDGE_TAKE_FROM_DNS,
} from '../../../workers/edge/scripts/deploy.mjs';
import { createCloudflareApi } from '../lib/cloudflareApi.mjs';
import { ENVS, MAIN_HOSTS } from '../lib/config.mjs';
import { ADDRESS_TYPES, checkDomainHolders, TAKE_FROM_DNS } from '../lib/domainHolder.mjs';
import { REHEARSAL_NAME } from '../lib/moveDomain.mjs';
import { fakeCloudflare } from './support/fakeCloudflare.mjs';

describe('паритет правил робочого домену', () => {
  it('MAIN_HOSTS однакові в ops і infra/cloudflare', () => {
    expect([...MAIN_HOSTS].sort()).toEqual([...CF_MAIN_HOSTS].sort());
  });

  it('MAIN_DOMAIN_ENVS розгортання Worker’а = середовища ops з mainDomain', () => {
    const opsMain = Object.keys(ENVS).filter((e) => ENVS[e].mainDomain === true);
    expect([...MAIN_DOMAIN_ENVS].sort()).toEqual(opsMain.sort());
  });

  it('ім’я репетиції move-domain = ENVS.rehearsal.siteHost', () => {
    expect(REHEARSAL_NAME).toBe(ENVS.rehearsal.siteHost);
  });
});

describe('A1: перевірка тримача імені — ops і розгортання Worker’а дають той самий результат', () => {
  const SELF = 't2f-edge-production';
  const OTHER = 't2f-edge-prelaunch';
  const HOSTS = ['time2fest.com', 'www.time2fest.com'];
  const rec = (/** @type {string} */ type, /** @type {string} */ content, meta = {}) => ({ name: 'time2fest.com', type, content, meta });
  const WORKER_REC = rec('AAAA', '100::', { read_only: true });
  const bind = (/** @type {string} */ service) => ({ id: 'd1', hostname: 'time2fest.com', service });

  it('ADDRESS_TYPES і TAKE_FROM_DNS однакові', () => {
    expect([...EDGE_ADDRESS_TYPES].sort()).toEqual([...ADDRESS_TYPES].sort());
    expect(EDGE_TAKE_FROM_DNS).toBe(TAKE_FROM_DNS);
  });

  /** @type {[string, Parameters<typeof fakeCloudflare>[0], string | undefined, boolean][]} опис, API, --take-domain-from, очікуване ok */
  const SCENARIOS = [
    ['вільне ім’я (лише MX)', { records: [rec('MX', 'mx.example.org')] }, undefined, true],
    ['чужий Worker', { bindings: [bind(OTHER)], records: [WORKER_REC] }, undefined, false],
    ['чужий Worker, take-from він', { bindings: [bind(OTHER)], records: [WORKER_REC] }, OTHER, true],
    ['чужий Worker, take-from інший', { bindings: [bind(OTHER)], records: [WORKER_REC] }, 't2f-edge-rehearsal', false],
    ['чужий Worker, take-from dns', { bindings: [bind(OTHER)], records: [WORKER_REC] }, 'dns', false],
    ['старий сайт A', { records: [rec('A', '203.0.113.50')] }, undefined, false],
    ['старий сайт AAAA', { records: [rec('AAAA', '2001:db8::50')] }, undefined, false],
    ['старий сайт CNAME', { records: [rec('CNAME', 'old.example.org')] }, undefined, false],
    ['старий сайт A, take-from dns', { records: [rec('A', '203.0.113.50')] }, 'dns', true],
    ['старий сайт A, take-from Worker', { records: [rec('A', '203.0.113.50')] }, OTHER, false],
    ['запис Worker’а з власною прив’язкою', { bindings: [bind(SELF)], records: [WORKER_REC] }, undefined, true],
    ['запис Worker’а без прив’язки', { records: [WORKER_REC] }, undefined, false],
    ['запис Worker’а без прив’язки, take-from dns', { records: [WORKER_REC] }, 'dns', true],
    ['маршрут зони чужого Worker’а', { routes: [{ pattern: '*time2fest.com/*', script: 'old-router' }] }, undefined, false],
    ['маршрут зони, take-from він', { routes: [{ pattern: 'time2fest.com/*', script: 'old-router' }] }, 'old-router', true],
    ['маршрут зони цього ж Worker’а', { routes: [{ pattern: 'time2fest.com/*', script: SELF }] }, undefined, true],
    ['take-from на вільному імені', {}, 'dns', false],
    ['403 на прив’язках', { bindingsStatus: 403 }, undefined, false],
    ['403 на записах DNS', { recordsStatus: 403 }, undefined, false],
    ['403 на маршрутах зони', { routesStatus: 403 }, undefined, false],
    ['500 на записах DNS', { recordsStatus: 500 }, undefined, false],
    ['500 на маршрутах зони', { routesStatus: 500 }, undefined, false],
  ];

  it.each(SCENARIOS)('%s', async (_name, cfo, takeFrom, expectedOk) => {
    const a = fakeCloudflare(cfo);
    const ops = await checkDomainHolders({
      api: createCloudflareApi({ fetch: a.fetch, account: 'acct1', token: 'tok-aaaaaaaa', zone: 'zone1' }),
      hosts: HOSTS,
      worker: SELF,
      takeFrom,
    });
    const b = fakeCloudflare(cfo);
    const edge = await edgeCheckDomainHolders({ fetch: b.fetch, token: 'tok-aaaaaaaa', account: 'acct1', zone: 'zone1', hosts: HOSTS, worker: SELF, takeFrom });
    expect(ops.ok).toBe(expectedOk);
    expect(edge.ok).toBe(ops.ok);
    expect(edge.ok ? edge.taken : null).toEqual(ops.ok ? ops.taken : null);
    // Ті самі запити в тому самому порядку.
    expect(b.calls.map((c) => c.url)).toEqual(a.calls.map((c) => c.url));
  });

  it('без зони обидві копії відмовляють без жодного запиту', async () => {
    const a = fakeCloudflare({});
    const ops = await checkDomainHolders({ api: createCloudflareApi({ fetch: a.fetch, account: 'acct1', token: 't', zone: null }), hosts: HOSTS, worker: SELF });
    const b = fakeCloudflare({});
    const edge = await edgeCheckDomainHolders({ fetch: b.fetch, token: 't', account: 'acct1', zone: undefined, hosts: HOSTS, worker: SELF });
    expect([ops.ok, edge.ok]).toEqual([false, false]);
    expect([a.calls, b.calls]).toEqual([[], []]);
  });
});
