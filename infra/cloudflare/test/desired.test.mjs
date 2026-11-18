// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { ENVS, EXEMPT_PATHS, MAIN_HOSTS, PAYPRO_IPN_SOURCES, PHASE_CONFIG, PHASE_CUSTOM } from '../lib/config.mjs';
import { ADMIN_PATH, desiredState, TUNNEL_PATH } from '../lib/desired.mjs';
import { createFakeApi } from './support/fakeApi.mjs';

const d = desiredState(['test']);
const rule = (/** @type {string} */ phase, /** @type {string} */ ref) => (d.rulesets[phase] ?? []).find((r) => r.ref === ref);

describe('desiredState(test)', () => {
  it('тунель: до джерела — лише /api/*, решта (зокрема /admin, /cms-api/*) — http_status:404', () => {
    const t = d.tunnels[0];
    expect(t?.name).toBe('t2f-test');
    expect(TUNNEL_PATH).toBe('^/api/');
    expect(t?.ingress).toEqual([
      { hostname: ENVS.test?.tunnelHost, path: '^/api/', service: ENVS.test?.originService },
      { service: 'http_status:404' },
    ]);
    const toOrigin = (/** @type {string} */ p) => new RegExp(TUNNEL_PATH).test(p);
    expect(['/api/time', '/api/webhooks/paypro'].every(toOrigin)).toBe(true);
    expect(['/admin', '/admin/login', '/cms-api/users', '/', '/x/api/'].some(toOrigin)).toBe(false);
  });

  it('DNS: проксований CNAME для хоста тунелю', () => {
    expect(d.dns).toEqual([{ env: 'test', name: 'o-test.time2fest.com', type: 'CNAME', tunnelName: 't2f-test', proxied: true }]);
  });

  it('skip-правило: хост сайту + усі шляхи-винятки для test, потрібні фази й продукти', () => {
    const r = rule(PHASE_CUSTOM, 't2f-skip-exempt');
    expect(r?.action).toBe('skip');
    expect(r?.expression).toContain('"test.time2fest.com"');
    const paths = EXEMPT_PATHS.filter((e) => e.envs === 'all' || e.envs.includes('test')).map((e) => e.path);
    const inExpr = [...r.expression.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
    expect(inExpr).toEqual(paths);
    expect(r?.action_parameters.phases).toEqual(['http_ratelimit', 'http_request_firewall_managed']);
    expect(r?.action_parameters.products).toEqual(['securityLevel', 'bic', 'uaBlock', 'zoneLockdown', 'hot']);
  });

  it('вебхук: виняток лише з опублікованих адрес PayPro; дверцята-відлуння — лише хост test, без умови на адресу', () => {
    const webhook = `(http.host in {"test.time2fest.com"} and http.request.uri.path eq "/api/webhooks/paypro" and ip.src in {${PAYPRO_IPN_SOURCES.join(' ')}})`;
    const echo = '(http.host in {"test.time2fest.com"} and http.request.uri.path eq "/api/_test/edge-echo")';
    expect(PAYPRO_IPN_SOURCES).toEqual(['198.199.123.239', '157.230.8.40', '2604:a880:400:d0::1843:7001', '2604:a880:400:d1::b6c:c001']);
    for (const r of [rule(PHASE_CUSTOM, 't2f-skip-exempt'), rule(PHASE_CONFIG, 't2f-exempt-config')]) {
      expect(r?.expression).toBe(`(${webhook} or ${echo})`);
    }
  });

  it('блок-правило називає хост тунелю', () => {
    const r = rule(PHASE_CUSTOM, 't2f-block-tunnel-hosts');
    expect(r?.action).toBe('block');
    expect(r?.expression).toContain('o-test.time2fest.com');
  });

  it('Under Attack вимкнено типово; конфіг-правило винятку стоїть останнім', () => {
    const cfg = d.rulesets[PHASE_CONFIG] ?? [];
    expect(cfg[0]?.ref).toBe('t2f-under-attack-test');
    expect(cfg[0]?.enabled).toBe(false);
    expect(cfg[0]?.action_parameters).toEqual({ security_level: 'under_attack' });
    expect(cfg.at(-1)?.ref).toBe('t2f-exempt-config');
    expect(cfg.at(-1)?.action_parameters).toEqual({ security_level: 'essentially_off', bic: false });
    expect(desiredState(['test'], { underAttack: true }).rulesets[PHASE_CONFIG]?.[0]?.enabled).toBe(true);
  });

  it('налаштування зони перевіряються: pseudo_ipv4 off, Bot Fight Mode off', () => {
    expect(d.zone).toEqual({ pseudo_ipv4: 'off', bot_fight_mode: false });
  });

  it('жоден вираз не називає хост робочого домену, кожен називає хост', () => {
    for (const rules of Object.values(d.rulesets)) {
      for (const r of rules) {
        for (const h of MAIN_HOSTS) expect(r.expression).not.toContain(`"${h}"`);
        expect(r.expression).toMatch(/http\.host/);
      }
    }
  });
});

describe('desiredState(test, rehearsal): усі середовища разом (AC-28, AC-29)', () => {
  const all = desiredState(['test', 'rehearsal']);
  const only = desiredState(['test']);
  const R = ENVS.rehearsal;

  it('rehearsal: тунель t2f-rehearsal; o-rehearsal — лише ^/api/; без Access адмінки немає; кінець http_status:404', () => {
    expect(R).toEqual({
      siteHost: 'rehearsal.time2fest.com',
      tunnelHost: 'o-rehearsal.time2fest.com',
      tunnelName: 't2f-rehearsal',
      originService: 'http://server:3000',
      adminHost: 'admin-rehearsal.time2fest.com',
      realtimeHost: 'rt-rehearsal.time2fest.com',
      realtimeService: 'http://centrifugo:8000',
      underAttack: false,
    });
    const t = all.tunnels.find((x) => x.env === 'rehearsal');
    expect(t?.name).toBe('t2f-rehearsal');
    expect(t?.ingress).toEqual([
      { hostname: 'o-rehearsal.time2fest.com', path: '^/api/', service: 'http://server:3000' },
      { hostname: 'rt-rehearsal.time2fest.com', path: '^/connection/', service: 'http://centrifugo:8000' },
      { service: 'http_status:404' },
    ]);
    expect(JSON.stringify(all)).not.toContain('admin-rehearsal');
  });

  it('F2: з адмінкою (admin.rehearsal) — ingress адмінки лише на шляхи Payload', () => {
    expect(ADMIN_PATH).toBe('^/(admin|cms-api|_next)(/|$)');
    const re = new RegExp(ADMIN_PATH);
    for (const p of ['/admin', '/admin/collections/events', '/cms-api/admins/me', '/_next/static/x.js']) expect(re.test(p)).toBe(true);
    for (const p of ['/', '/api/health', '/administrator', '/cms-apix', '/x/admin']) expect(re.test(p)).toBe(false);
    const withAdmin = desiredState(['test', 'rehearsal'], { admin: { rehearsal: true } });
    expect(withAdmin.tunnels.find((x) => x.env === 'rehearsal')?.ingress).toEqual([
      { hostname: 'o-rehearsal.time2fest.com', path: '^/api/', service: 'http://server:3000' },
      { hostname: 'admin-rehearsal.time2fest.com', path: ADMIN_PATH, service: 'http://server:3000' },
      { hostname: 'rt-rehearsal.time2fest.com', path: '^/connection/', service: 'http://centrifugo:8000' },
      { service: 'http_status:404' },
    ]);
  });

  it('DNS: проксований CNAME на тунель t2f-rehearsal; ім’я адмінки — лише з admin.rehearsal', () => {
    expect(all.dns.filter((x) => x.env === 'rehearsal')).toEqual([
      { env: 'rehearsal', name: 'o-rehearsal.time2fest.com', type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true },
      { env: 'rehearsal', name: 'rt-rehearsal.time2fest.com', type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true },
    ]);
    expect(desiredState(['test', 'rehearsal'], { admin: { rehearsal: true } }).dns.filter((x) => x.env === 'rehearsal')).toEqual([
      { env: 'rehearsal', name: 'o-rehearsal.time2fest.com', type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true },
      { env: 'rehearsal', name: 'admin-rehearsal.time2fest.com', type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true },
      { env: 'rehearsal', name: 'rt-rehearsal.time2fest.com', type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true },
    ]);
  });

  it('F2: залишок адмінки без Access (staleAdmin) — у блок-правилі; з Access — ні', () => {
    const block = (/** @type {typeof all} */ d) => (d.rulesets[PHASE_CUSTOM] ?? []).find((r) => r.ref === 't2f-block-tunnel-hosts')?.expression;
    expect(block(desiredState(['test', 'rehearsal'], { staleAdmin: ['admin-rehearsal.time2fest.com'] }))).toBe(
      '(http.host in {"o-test.time2fest.com" "o-rehearsal.time2fest.com" "admin-rehearsal.time2fest.com"})',
    );
    expect(block(desiredState(['test', 'rehearsal'], { admin: { rehearsal: true }, staleAdmin: ['admin-rehearsal.time2fest.com'] }))).not.toContain('admin-rehearsal');
  });

  it('блок-правило: o-rehearsal є, admin-rehearsal немає; нового власного правила немає', () => {
    const custom = all.rulesets[PHASE_CUSTOM] ?? [];
    const block = custom.find((r) => r.ref === 't2f-block-tunnel-hosts');
    expect(block?.expression).toBe('(http.host in {"o-test.time2fest.com" "o-rehearsal.time2fest.com"})');
    expect(block?.expression).not.toContain('admin-rehearsal');
    expect(custom).toHaveLength(2);
    expect(all.rulesets[PHASE_CONFIG]).toHaveLength(4);
    expect((all.rulesets[PHASE_CONFIG] ?? []).map((r) => r.ref)).toEqual(['t2f-under-attack-test', 't2f-under-attack-rehearsal', 't2f-realtime-rehearsal', 't2f-exempt-config']);
    for (const rules of Object.values(all.rulesets)) for (const r of rules) for (const h of MAIN_HOSTS) expect(r.expression).not.toContain(`"${h}"`);
  });

  it('realtime репетиції: ingress лише /connection/ → centrifugo:8000, CNAME, security_level off, не в блок-правилі', () => {
    const t = all.tunnels.find((x) => x.env === 'rehearsal');
    const rt = t?.ingress.find((i) => i.hostname === 'rt-rehearsal.time2fest.com');
    expect(rt).toEqual({ hostname: 'rt-rehearsal.time2fest.com', path: '^/connection/', service: 'http://centrifugo:8000' });
    expect(t?.ingress.at(-1)).toEqual({ service: 'http_status:404' });
    expect(all.dns.find((d) => d.name === 'rt-rehearsal.time2fest.com')).toMatchObject({ type: 'CNAME', tunnelName: 't2f-rehearsal', proxied: true });
    const rule = (all.rulesets[PHASE_CONFIG] ?? []).find((r) => r.ref === 't2f-realtime-rehearsal');
    expect(rule).toMatchObject({ expression: '(http.host eq "rt-rehearsal.time2fest.com")', action: 'set_config', enabled: true });
    expect(rule?.action_parameters).toEqual({ security_level: 'off', bic: false });
    for (const r of all.rulesets[PHASE_CUSTOM] ?? []) expect(r.expression).not.toContain('rt-rehearsal');
    expect(JSON.stringify(only)).not.toContain('rt-');
  });

  it('обʼєкти test байт-у-байт ті самі, що в desiredState([test])', () => {
    const json = (/** @type {unknown} */ v) => JSON.stringify(v);
    expect(json(all.tunnels.filter((x) => x.env === 'test'))).toBe(json(only.tunnels));
    expect(json(all.dns.filter((x) => x.env === 'test'))).toBe(json(only.dns));
    const ua = (/** @type {typeof all} */ d) => (d.rulesets[PHASE_CONFIG] ?? []).find((r) => r.ref === 't2f-under-attack-test');
    expect(json(ua(all))).toBe(json(ua(only)));
  });

  it('under-attack мапою: лише назване середовище; булеве — як раніше', () => {
    const cfg = (/** @type {typeof all} */ d) => Object.fromEntries((d.rulesets[PHASE_CONFIG] ?? []).map((r) => [r.ref, r.enabled]));
    const on = cfg(desiredState(['test', 'rehearsal'], { underAttack: { rehearsal: true, test: undefined } }));
    expect(on['t2f-under-attack-rehearsal']).toBe(true);
    expect(on['t2f-under-attack-test']).toBe(false);
    expect(cfg(desiredState(['test', 'rehearsal'], { underAttack: true }))['t2f-under-attack-test']).toBe(true);
  });

  it('cf.mjs plan --env test будує обидва середовища (у журналі фейка — обʼєкти rehearsal)', async () => {
    const fake = createFakeApi();
    /** @type {string[]} */
    const lines = [];
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cf-plan-'));
    const code = await main(['plan', '--env', 'test'], {
      env: { CLOUDFLARE_API_TOKEN_INFRA: `tok-${'9a'.repeat(8)}`, CLOUDFLARE_ACCOUNT_ID: 'acct-test', CLOUDFLARE_ZONE_ID: 'zone-test' },
      fetch: fake.fetch,
      out: (l) => lines.push(l),
      localDir,
    });
    fs.rmSync(localDir, { recursive: true, force: true });
    expect(code).toBe(0);
    const paths = fake.log.map((l) => `${l.method} ${l.path}`);
    expect(fake.log.every((l) => l.method === 'GET')).toBe(true);
    expect(paths.filter((p) => p.endsWith('/cfd_tunnel'))).toHaveLength(2);
    // o-test, o-rehearsal, rt-rehearsal і (лише читання — пошук залишку) admin-rehearsal.
    expect(paths.filter((p) => p.endsWith('/dns_records'))).toHaveLength(4);
    expect(paths.some((p) => p.includes('/access/'))).toBe(false);
    const text = lines.join('\n');
    expect(text).toContain('тунель t2f-rehearsal');
    expect(text).toContain('DNS o-rehearsal.time2fest.com');
    expect(text).not.toContain('admin-rehearsal');
    expect(text).toContain('t2f-under-attack-rehearsal');
    expect(text).toContain('тунель t2f-test');
  });
});
