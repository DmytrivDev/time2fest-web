// @ts-check
// Запобіжник (AC-40): без явного прапорця — код 2 і жодного запиту на зміну; з прапорцем — дозволено.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { PHASE_CUSTOM } from '../lib/config.mjs';
import { desiredState } from '../lib/desired.mjs';
import { guard } from '../lib/guard.mjs';
import { createFakeApi } from './support/fakeApi.mjs';

// Фальшиві значення збираються під час виконання.
const tok = `tok-${'d4'.repeat(8)}`;
const tunnelTok = `tt-${'e5'.repeat(8)}`;

/** @type {string} */
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cf-guard-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const baseEnv = () => ({
  CLOUDFLARE_API_TOKEN_INFRA: tok,
  CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  CLOUDFLARE_ZONE_ID: 'zone-test',
  T2F_LOCK_DIR: path.join(tmp, 'locks'),
});

/**
 * @param {ReturnType<typeof createFakeApi>} fake
 * @param {string[]} argv
 * @param {typeof desiredState} [desired]
 */
async function run(fake, argv, desired) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, {
    env: baseEnv(),
    fetch: fake.fetch,
    out: (l) => lines.push(l),
    localDir: path.join(tmp, '.local'),
    desiredState: desired,
  });
  return { code, lines, text: lines.join('\n') };
}

/** Фальшивий Cloudflare, що вже відповідає бажаному стану. */
function converged() {
  const fake = createFakeApi();
  const d = desiredState(['test']);
  fake.seed({
    tunnels: [{ id: 'tun1', name: 't2f-test', token: tunnelTok, ingress: d.tunnels[0]?.ingress ?? null }],
    dns: [...fake.state.dns, { id: 'd1', name: 'o-test.time2fest.com', type: 'CNAME', content: 'tun1.cfargotunnel.com', proxied: true }],
    rulesets: Object.fromEntries(Object.entries(d.rulesets).map(([p, rs]) => [p, rs.map((r, i) => ({ id: `r${i}`, ...r }))])),
  });
  return fake;
}

/**
 * Бажаний стан із додатковим правилом, що називає хост.
 * @param {string} host
 * @returns {typeof desiredState}
 */
const withHostRule = (host) => (envs, opts) => {
  const d = desiredState(envs, opts);
  d.rulesets[PHASE_CUSTOM]?.push({ ref: 't2f-probe-host', description: 'probe', expression: `(http.host eq "${host}")`, action: 'block', enabled: true });
  return d;
};

/** @param {ReturnType<typeof createFakeApi>} fake */
const mutations = (fake) => fake.mutations().length;

describe('guard через CLI: п’ять випадків (AC-40)', () => {
  for (const host of ['time2fest.com', 'www.time2fest.com', 'admin.time2fest.com']) {
    it(`зміна, що називає ${host}: без прапорця — код 2 і 0 змін; з --allow-main-domain — застосовано`, async () => {
      const refusedFake = converged();
      const refused = await run(refusedFake, ['apply', '--env', 'test'], withHostRule(host));
      expect(refused.code).toBe(2);
      expect(mutations(refusedFake)).toBe(0);
      expect(refused.text).toContain('--allow-main-domain');
      expect(refused.text).toContain(host);

      const allowedFake = converged();
      const allowed = await run(allowedFake, ['apply', '--env', 'test', '--allow-main-domain'], withHostRule(host));
      expect(allowed.code).toBe(0);
      expect(allowedFake.state.rulesets[PHASE_CUSTOM]?.some((r) => r.ref === 't2f-probe-host')).toBe(true);
    });
  }

  it('дрейф налаштування зони pseudo_ipv4: без прапорця — код 2 і 0 змін; з --allow-zone-settings — PATCH', async () => {
    const refusedFake = converged();
    refusedFake.state.settings.pseudo_ipv4 = 'add_header';
    const refused = await run(refusedFake, ['apply', '--env', 'test']);
    expect(refused.code).toBe(2);
    expect(mutations(refusedFake)).toBe(0);
    expect(refused.text).toContain('--allow-zone-settings');

    const allowedFake = converged();
    allowedFake.state.settings.pseudo_ipv4 = 'add_header';
    const allowed = await run(allowedFake, ['apply', '--env', 'test', '--allow-zone-settings']);
    expect(allowed.code).toBe(0);
    expect(allowedFake.mutations()).toEqual([{ method: 'PATCH', path: '/zones/zone-test/settings/pseudo_ipv4' }]);
    expect(allowedFake.state.settings.pseudo_ipv4).toBe('off');
  });

  it('чуже правило фази без бажаного ref (видалення): без прапорця — код 2 і 0 змін; з --allow-delete — правило зникає', async () => {
    const extra = { id: 'rx', ref: 'manual-rule', description: 'manual', expression: '(http.host eq "test.time2fest.com")', action: 'block', enabled: true };
    const refusedFake = converged();
    refusedFake.state.rulesets[PHASE_CUSTOM]?.push({ ...extra });
    const refused = await run(refusedFake, ['apply', '--env', 'test']);
    expect(refused.code).toBe(2);
    expect(mutations(refusedFake)).toBe(0);
    expect(refused.text).toContain('--allow-delete');

    const allowedFake = converged();
    allowedFake.state.rulesets[PHASE_CUSTOM]?.push({ ...extra });
    const allowed = await run(allowedFake, ['apply', '--env', 'test', '--allow-delete']);
    expect(allowed.code).toBe(0);
    expect(allowedFake.mutations()).toEqual([{ method: 'PUT', path: `/zones/zone-test/rulesets/phases/${PHASE_CUSTOM}/entrypoint` }]);
    expect(allowedFake.state.rulesets[PHASE_CUSTOM]?.some((r) => r.ref === 'manual-rule')).toBe(false);
  });

  for (const type of ['MX', 'TXT']) {
    it(`поштовий DNS-запис ${type}: код 2 і 0 змін навіть з усіма прапорцями`, async () => {
      const fake = converged();
      /** @type {typeof desiredState} */
      const mail = (envs, opts) => {
        const d = desiredState(envs, opts);
        d.dns.push({ env: 'test', name: 'time2fest.com', type, tunnelName: 't2f-test', proxied: false });
        return d;
      };
      const r = await run(fake, ['apply', '--env', 'test', '--allow-main-domain', '--allow-zone-settings', '--allow-delete'], mail);
      expect(r.code).toBe(2);
      expect(mutations(fake)).toBe(0);
      expect(r.text).toContain('жоден прапорець не дозволяє');
      expect(fake.state.dns.find((x) => x.type === 'MX')).toEqual(expect.objectContaining({ name: 'time2fest.com', content: 'mx.example.net' }));
    });
  }

  it('plan друкує ті самі вердикти, але завершується кодом 0 і лише GET', async () => {
    const fake = converged();
    fake.state.settings.pseudo_ipv4 = 'add_header';
    const r = await run(fake, ['plan', '--env', 'test'], withHostRule('www.time2fest.com'));
    expect(r.code).toBe(0);
    expect(r.text).toContain('--allow-main-domain');
    expect(r.text).toContain('--allow-zone-settings');
    expect(mutations(fake)).toBe(0);
  });
});

describe('guard: одиниці', () => {
  /** @param {Partial<import('../lib/diff.mjs').Change>} c @returns {import('../lib/diff.mjs').Change} */
  const ch = (c) => ({ kind: 'rule', op: 'update', target: 't', hosts: ['test.time2fest.com'], summary: 's', category: 'waf', ...c });

  it('звичайна зміна тестового хоста проходить без прапорців', () => {
    expect(guard([ch({})]).ok).toBe(true);
  });

  it('регістр і кінцева крапка не обходять захищені хости', () => {
    const r = guard([ch({ hosts: ['WWW.Time2Fest.com.'] })]);
    expect(r.refused.map((x) => x.flag)).toEqual(['--allow-main-domain']);
  });

  it('видалення правила робочого домену потребує обох прапорців', () => {
    const c = ch({ op: 'delete', hosts: ['admin.time2fest.com'] });
    expect(guard([c]).refused.map((x) => x.flag).sort()).toEqual(['--allow-delete', '--allow-main-domain']);
    expect(guard([c], { allowDelete: true }).refused.map((x) => x.flag)).toEqual(['--allow-main-domain']);
    expect(guard([c], { allowDelete: true, allowMainDomain: true }).ok).toBe(true);
  });

  it('безхостове правило й порожній перелік хостів — дія на всю зону', () => {
    expect(guard([ch({ hosts: ['*zone*'] })]).refused[0]?.flag).toBe('--allow-zone-settings');
    expect(guard([ch({ hosts: [] })]).refused[0]?.flag).toBe('--allow-zone-settings');
  });

  it('невідомий вид, операція або тип DNS — заборонено без можливості дозволу', () => {
    const all = { allowMainDomain: true, allowZoneSettings: true, allowDelete: true };
    expect(guard([ch({ kind: 'worker' })], all).refused[0]?.flag).toBeNull();
    expect(guard([ch({ op: /** @type {any} */ ('purge') })], all).refused[0]?.flag).toBeNull();
    expect(guard([ch({ kind: 'dns', category: 'dns', data: { type: 'A' } })], all).refused[0]?.flag).toBeNull();
    expect(guard([ch({ kind: 'dns', category: 'dns', data: { type: 'mx' } })], all).refused[0]?.flag).toBeNull();
  });
});
