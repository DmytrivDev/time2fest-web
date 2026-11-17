// @ts-check

/** Псевдо-хост для правила без хоста та для налаштування зони: вважається дією на всю зону. */
export const ZONE_WIDE = '*zone*';

/**
 * Псевдо-хост для виразу з логікою хостів, яку розбір не охоплює (заперечення, шаблони, підрядки,
 * повний URI, `lower(`, хост з кінцевою крапкою чи великими літерами). Запобіжник вважає його
 * робочим доменом (deny by default).
 */
export const OPAQUE_HOST = '*opaque-host-logic*';

const HOST_RE = /"([a-z0-9.-]*time2fest\.com)"/gi;
/** Будь-який рядок у лапках, що згадує домен: має бути точним нижньорегістровим іменем хоста. */
const QUOTED_DOMAIN_RE = /"([^"]*time2fest\.com[^"]*)"/gi;
const CLEAN_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
/** Оператори й функції, з якими набір хостів не можна вивести з рядків у лапках. */
const OPAQUE_LOGIC_RE = /\bnot\s|!|\bne\b|\bwildcard\b|\bmatches\b|~|\bends_with\b|\bcontains\b|\bstarts_with\b|\bfull_uri\b|\blower\(/i;

/**
 * Усі імена хостів у виразі; порожньо → зона; логіка, яку розбір не охоплює → `OPAQUE_HOST`.
 * @param {string} expression
 * @returns {string[]}
 */
export function hostsOf(expression) {
  const text = String(expression);
  const found = [...text.matchAll(HOST_RE)].map((m) => String(m[1]).toLowerCase());
  const oddHost = [...text.matchAll(QUOTED_DOMAIN_RE)].some((m) => !CLEAN_HOST_RE.test(String(m[1])));
  if (OPAQUE_LOGIC_RE.test(text) || oddHost) found.push(OPAQUE_HOST);
  return found.length ? [...new Set(found)] : [ZONE_WIDE];
}

/** @param {any} v @returns {any} */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}

/** @param {any} a @param {any} b */
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** @param {any} r */
const ruleView = (r) => ({
  description: r.description ?? '',
  expression: r.expression,
  action: r.action,
  action_parameters: r.action_parameters ?? null,
  enabled: r.enabled ?? true,
});

/**
 * @typedef {{ kind: string, op: 'create' | 'update' | 'delete', target: string, hosts: string[], summary: string, category: string, data?: any }} Change
 */

/**
 * Упорядкований список змін: тунелі, DNS, набори правил, налаштування зони.
 * @param {ReturnType<typeof import('./desired.mjs').desiredState>} desired
 * @param {Awaited<ReturnType<typeof import('./current.mjs').readCurrent>>} current
 * @returns {Change[]}
 */
export function diff(desired, current) {
  /** @type {Change[]} */
  const changes = [];

  for (const t of desired.tunnels) {
    const cur = current.tunnels.find((c) => c.name === t.name);
    const hosts = [t.hostname];
    if (!cur) {
      changes.push({ kind: 'tunnel', op: 'create', target: t.name, hosts, category: 'tunnel', summary: `тунель ${t.name}: створити з ingress → ${t.ingress[0]?.service}`, data: t });
    } else if (!same(cur.ingress, t.ingress)) {
      changes.push({ kind: 'tunnel-config', op: 'update', target: t.name, hosts, category: 'tunnel', summary: `тунель ${t.name}: оновити ingress`, data: { ...t, tunnelId: cur.id } });
    }
  }

  for (const d of desired.dns) {
    const tunnel = current.tunnels.find((c) => c.name === d.tunnelName);
    const content = tunnel ? `${tunnel.id}.cfargotunnel.com` : null;
    const cur = current.dns.find((r) => r.name === d.name && r.type === d.type);
    const hosts = [d.name];
    if (!cur) {
      changes.push({ kind: 'dns', op: 'create', target: d.name, hosts, category: 'dns', summary: `DNS ${d.name}: створити CNAME (proxied) → тунель ${d.tunnelName}`, data: d });
    } else if (content === null || cur.content !== content || cur.proxied !== d.proxied) {
      changes.push({ kind: 'dns', op: 'update', target: d.name, hosts, category: 'dns', summary: `DNS ${d.name}: оновити CNAME → тунель ${d.tunnelName}`, data: { ...d, id: cur.id } });
    }
  }

  for (const [phase, rules] of Object.entries(desired.rulesets)) {
    const category = phase === 'http_config_settings' ? 'config-rules' : 'waf';
    const curRules = current.rulesets[phase] ?? [];
    for (const r of rules) {
      const cur = curRules.find((c) => c.ref === r.ref);
      const hosts = hostsOf(r.expression);
      if (!cur) {
        changes.push({ kind: 'rule', op: 'create', target: `${phase}/${r.ref}`, hosts, category, summary: `правило ${r.ref} (${phase}): створити`, data: { phase, rule: r } });
      } else if (!same(ruleView(cur), ruleView(r))) {
        changes.push({ kind: 'rule', op: 'update', target: `${phase}/${r.ref}`, hosts, category, summary: `правило ${r.ref} (${phase}): оновити`, data: { phase, rule: r } });
      }
    }
    for (const cur of curRules) {
      if (!rules.some((r) => r.ref === cur.ref)) {
        changes.push({ kind: 'rule', op: 'delete', target: `${phase}/${cur.ref ?? cur.id}`, hosts: hostsOf(cur.expression ?? ''), category, summary: `правило ${cur.ref ?? cur.id} (${phase}): видалити`, data: { phase, rule: cur } });
      }
    }
  }

  if (current.zone.pseudo_ipv4 !== desired.zone.pseudo_ipv4) {
    changes.push({ kind: 'zone-setting', op: 'update', target: 'pseudo_ipv4', hosts: [ZONE_WIDE], category: 'zone-settings', summary: `налаштування зони pseudo_ipv4: ${current.zone.pseudo_ipv4} → ${desired.zone.pseudo_ipv4}`, data: { setting: 'pseudo_ipv4', value: desired.zone.pseudo_ipv4 } });
  }
  if (current.zone.bot_fight_mode !== desired.zone.bot_fight_mode) {
    changes.push({ kind: 'zone-setting', op: 'update', target: 'bot_fight_mode', hosts: [ZONE_WIDE], category: 'bot-management', summary: `Bot Fight Mode: ${current.zone.bot_fight_mode} → ${desired.zone.bot_fight_mode}`, data: { setting: 'bot_fight_mode', value: desired.zone.bot_fight_mode } });
  }

  return changes;
}
