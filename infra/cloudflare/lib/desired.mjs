// @ts-check
import { ENVS, PHASE_CONFIG, PHASE_CUSTOM, exemptPathsFor } from './config.mjs';

/** @param {string[]} items */
const set = (items) => `{${items.map((i) => `"${i}"`).join(' ')}}`;

/**
 * Бажаний стан для вказаних середовищ. Кожен вираз правила називає хости.
 * @param {string[]} envNames
 * @param {{ underAttack?: boolean }} [opts] `underAttack` перекриває типове значення середовища
 */
export function desiredState(envNames, opts = {}) {
  const envs = envNames.map((n) => {
    const e = ENVS[n];
    if (!e) throw new Error(`невідоме середовище: ${n}`);
    return { name: n, ...e };
  });
  const siteHosts = envs.map((e) => e.siteHost);
  const tunnelHosts = envs.map((e) => e.tunnelHost);
  const paths = [...new Set(envs.flatMap((e) => exemptPathsFor(e.name).map((p) => p.path)))];
  const exemptExpr = `(http.host in ${set(siteHosts)} and http.request.uri.path in ${set(paths)})`;

  const tunnels = envs.map((e) => ({
    env: e.name,
    name: e.tunnelName,
    hostname: e.tunnelHost,
    ingress: [{ hostname: e.tunnelHost, service: e.originService }, { service: 'http_status:404' }],
  }));

  const dns = envs.map((e) => ({
    env: e.name,
    name: e.tunnelHost,
    type: 'CNAME',
    tunnelName: e.tunnelName,
    proxied: true,
  }));

  /** @type {any[]} */
  const custom = [
    {
      ref: 't2f-skip-exempt',
      description: 't2f: skip security for exempt paths',
      expression: exemptExpr,
      action: 'skip',
      action_parameters: {
        ruleset: 'current',
        phases: ['http_ratelimit', 'http_request_firewall_managed'],
        products: ['securityLevel', 'bic', 'uaBlock', 'zoneLockdown', 'hot'],
      },
      enabled: true,
    },
    {
      ref: 't2f-block-tunnel-hosts',
      description: 't2f: block direct access to tunnel hosts',
      expression: `(http.host in ${set(tunnelHosts)})`,
      action: 'block',
      enabled: true,
    },
  ];

  /** @type {any[]} */
  const config = [
    ...envs.map((e) => ({
      ref: `t2f-under-attack-${e.name}`,
      description: `t2f: Under Attack toggle for ${e.name}`,
      expression: `(http.host eq "${e.siteHost}")`,
      action: 'set_config',
      action_parameters: { security_level: 'under_attack' },
      enabled: opts.underAttack ?? e.underAttack,
    })),
    // Останнє правило перемагає: винятки шляхів не підпадають під Under Attack.
    {
      ref: 't2f-exempt-config',
      description: 't2f: relax security level for exempt paths',
      expression: exemptExpr,
      action: 'set_config',
      action_parameters: { security_level: 'essentially_off', bic: false },
      enabled: true,
    },
  ];

  return {
    tunnels,
    dns,
    /** @type {Record<string, any[]>} */
    rulesets: { [PHASE_CUSTOM]: custom, [PHASE_CONFIG]: config },
    /** Лише перевіряється; пишеться тільки з `--allow-zone-settings`. */
    zone: { pseudo_ipv4: 'off', bot_fight_mode: false },
  };
}
