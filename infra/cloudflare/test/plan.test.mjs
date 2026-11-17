// @ts-check
import { describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { desiredState } from '../lib/desired.mjs';
import { diff, hostsOf } from '../lib/diff.mjs';
import { createFakeApi } from './support/fakeApi.mjs';

// Фальшиві секрети збираються під час виконання, щоб не скидатися на справжні.
const tok = `tok-${'a1'.repeat(8)}`;
const edgeSecret = `es-${'b2'.repeat(8)}`;
const tunnelTok = `tt-${'c3'.repeat(8)}`;

const baseEnv = () => ({
  CLOUDFLARE_API_TOKEN_INFRA: tok,
  CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  CLOUDFLARE_ZONE_ID: 'zone-test',
});

/** @param {ReturnType<typeof createFakeApi>} fake @param {Record<string, string | undefined>} env @param {string[]} [argv] */
async function run(fake, env, argv = ['plan', '--env', 'test']) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, { env: { ...env }, fetch: fake.fetch, out: (l) => lines.push(l) });
  return { code, lines, text: lines.join('\n') };
}

/** Фальшивий Cloudflare, що вже відповідає бажаному стану. */
function converged() {
  const fake = createFakeApi();
  const d = desiredState(['test']);
  fake.seed({
    tunnels: [{ id: 'tun1', name: 't2f-test', token: tunnelTok, ingress: d.tunnels[0]?.ingress ?? null }],
    dns: [
      ...fake.state.dns,
      { id: 'd1', name: 'o-test.time2fest.com', type: 'CNAME', content: 'tun1.cfargotunnel.com', proxied: true },
    ],
    rulesets: Object.fromEntries(Object.entries(d.rulesets).map(([p, rs]) => [p, rs.map((r, i) => ({ id: `r${i}`, ...r }))])),
  });
  return fake;
}

describe('plan', () => {
  it('порожній Cloudflare: список змін непорожній, лише GET (AC-38)', async () => {
    const fake = createFakeApi();
    const r = await run(fake, baseEnv());
    expect(r.code).toBe(0);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.text).not.toContain('без змін');
    expect(r.text).toContain('t2f-skip-exempt');
    expect(fake.log.length).toBeGreaterThan(0);
    expect(fake.log.every((l) => l.method === 'GET')).toBe(true);
    // пошту (MX) скрипт не читає й не чіпає
    expect(fake.log.some((l) => l.path.includes('dns_records'))).toBe(true);
    expect(r.text).not.toMatch(/MX|mx\.example/);
  });

  it('збіжний стан: «без змін», нуль змін (AC-39 діф)', async () => {
    const fake = converged();
    const r = await run(fake, baseEnv());
    expect(r.code).toBe(0);
    expect(r.text).toBe('без змін');
    expect(fake.mutations()).toEqual([]);
  });

  it('вивід не містить секретів (AC-42)', async () => {
    const fake = converged();
    fake.state.tunnels[0] = { ...fake.state.tunnels[0], id: 'tun1', name: 't2f-test', ingress: null, token: tunnelTok };
    const r = await run(fake, { ...baseEnv(), CLOUDFLARE_API_TOKEN: `${tok}-alt`, T2F_EDGE_SECRET: edgeSecret, TUNNEL_TOKEN: tunnelTok });
    for (const s of [tok, `${tok}-alt`, edgeSecret, tunnelTok]) expect(r.text).not.toContain(s);
    // відмова теж не друкує токен
    fake.refuse('dns', 403);
    const refused = await run(fake, baseEnv());
    expect(refused.code).toBe(1);
    expect(refused.text).not.toContain(tok);
    expect(refused.text).toContain('dns');
  });

  it('без токена: код 1, названа змінна, жодного запиту (AC-44)', async () => {
    const fake = createFakeApi();
    const { CLOUDFLARE_API_TOKEN_INFRA: _t, ...env } = baseEnv();
    const r = await run(fake, env);
    expect(r.code).toBe(1);
    expect(r.text).toContain('CLOUDFLARE_API_TOKEN_INFRA');
    expect(r.text).toContain('Zone WAF');
    expect(fake.log).toEqual([]);
  });

  it('apply без токена: код 1, названа змінна, жодного запиту (AC-44)', async () => {
    const fake = createFakeApi();
    const { CLOUDFLARE_API_TOKEN_INFRA: _t, ...env } = baseEnv();
    const r = await run(fake, env, ['apply', '--env', 'test']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('CLOUDFLARE_API_TOKEN_INFRA');
    expect(fake.log).toEqual([]);
  });

  it('CLOUDFLARE_API_BASE: лише loopback', async () => {
    const fake = createFakeApi();
    const r = await run(fake, { ...baseEnv(), CLOUDFLARE_API_BASE: 'https://evil.example.com' });
    expect(r.code).toBe(1);
    expect(fake.log).toEqual([]);
  });
});

describe('diff', () => {
  it('змінений вираз → update; зайве правило → delete; відсутній ентріпойнт → create', () => {
    const d = desiredState(['test']);
    const cur = {
      tunnels: [{ name: 't2f-test', id: 'tun1', ingress: d.tunnels[0]?.ingress ?? null }],
      dns: [{ id: 'd1', name: 'o-test.time2fest.com', type: 'CNAME', content: 'tun1.cfargotunnel.com', proxied: true }],
      rulesets: {
        http_request_firewall_custom: [
          { ref: 't2f-skip-exempt', ...d.rulesets.http_request_firewall_custom?.[0], expression: '(http.host eq "test.time2fest.com")' },
          d.rulesets.http_request_firewall_custom?.[1],
          { ref: 'manual', expression: '(http.host eq "www.time2fest.com")', action: 'block' },
        ],
        http_config_settings: [],
      },
      zone: { pseudo_ipv4: 'off', bot_fight_mode: false },
    };
    const ch = diff(d, cur);
    expect(ch.map((c) => `${c.op}:${c.target}`)).toEqual([
      'update:http_request_firewall_custom/t2f-skip-exempt',
      'delete:http_request_firewall_custom/manual',
      'create:http_config_settings/t2f-under-attack-test',
      'create:http_config_settings/t2f-exempt-config',
    ]);
    expect(ch[1]?.hosts).toEqual(['www.time2fest.com']);
  });

  it('налаштування зони й безхостове правило → *zone*', () => {
    expect(hostsOf('(http.request.uri.path eq "/x")')).toEqual(['*zone*']);
    const d = desiredState(['test']);
    const ch = diff(d, { tunnels: [], dns: [], rulesets: {}, zone: { pseudo_ipv4: 'on', bot_fight_mode: true } });
    expect(ch.filter((c) => c.kind === 'zone-setting').every((c) => c.hosts[0] === '*zone*')).toBe(true);
    expect(ch.filter((c) => c.kind === 'zone-setting')).toHaveLength(2);
  });
});

describe('Bot Management Read is optional', () => {
  it('plan continues with a warning when the token cannot read bot management (403)', async () => {
    const fake = createFakeApi();
    fake.refuse('bot-management', 403);
    const r = await run(fake, baseEnv());
    expect(r.code).toBe(0);
    expect(r.text).toContain('Bot Fight Mode: стан не перевірено');
    expect(r.text).not.toContain('Bot Fight Mode: true');
    expect(fake.mutations()).toEqual([]);
  });

  it('an unknown Bot Fight Mode state produces no change', () => {
    const d = desiredState(['test']);
    const ch = diff(d, { tunnels: [], dns: [], rulesets: {}, zone: { pseudo_ipv4: 'off', bot_fight_mode: null } });
    expect(ch.some((c) => c.target === 'bot_fight_mode')).toBe(false);
  });
});
