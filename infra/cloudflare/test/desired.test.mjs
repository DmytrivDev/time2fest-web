// @ts-check
import { describe, expect, it } from 'vitest';
import { ENVS, EXEMPT_PATHS, MAIN_HOSTS, PAYPRO_IPN_SOURCES, PHASE_CONFIG, PHASE_CUSTOM } from '../lib/config.mjs';
import { desiredState, TUNNEL_PATH } from '../lib/desired.mjs';

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
