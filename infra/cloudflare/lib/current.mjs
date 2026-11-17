// @ts-check
import { ApiRefusal } from './api.mjs';
import { PHASE_CONFIG, PHASE_CUSTOM } from './config.mjs';

/**
 * Читає поточний стан (лише GET).
 * @param {{ get: (category: string, path: string) => Promise<any> }} api
 * @param {{ accountId: string, zoneId: string }} ids
 * @param {{ tunnels: { name: string }[], dns: { name: string }[] }} desired
 * @param {{ add: (v: string | undefined) => void }} [redactor] отримує токени тунелів, що трапились у відповідях
 * @param {string[]} [watchDns] ще імена, чиї записи DNS прочитати (імена адмінки без Access — пошук залишків)
 */
export async function readCurrent(api, { accountId, zoneId }, desired, redactor, watchDns = []) {
  const q = encodeURIComponent;
  /** @type {{ name: string, id: string, ingress: any[] | null }[]} */
  const tunnels = [];
  for (const t of desired.tunnels) {
    const list = (await api.get('tunnel', `/accounts/${accountId}/cfd_tunnel?name=${q(t.name)}&is_deleted=false`)) ?? [];
    const found = list[0];
    if (!found) continue;
    redactor?.add(found.token);
    const cfg = await api.get('tunnel', `/accounts/${accountId}/cfd_tunnel/${found.id}/configurations`);
    tunnels.push({ name: t.name, id: String(found.id), ingress: cfg?.config?.ingress ?? null });
  }

  /** @type {{ id: string, name: string, type: string, content: string, proxied: boolean }[]} */
  const dns = [];
  const names = [...new Set([...desired.dns.map((d) => d.name), ...watchDns])];
  for (const name of names) {
    const list = (await api.get('dns', `/zones/${zoneId}/dns_records?name=${q(name)}`)) ?? [];
    for (const r of list) dns.push({ id: r.id, name: r.name, type: r.type, content: r.content, proxied: !!r.proxied });
  }

  /** @type {Record<string, any[]>} */
  const rulesets = {};
  for (const [phase, category] of /** @type {[string, string][]} */ ([[PHASE_CUSTOM, 'waf'], [PHASE_CONFIG, 'config-rules']])) {
    try {
      const rs = await api.get(category, `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
      rulesets[phase] = rs?.rules ?? [];
    } catch (e) {
      if (e instanceof ApiRefusal && e.status === 404) rulesets[phase] = [];
      else throw e;
    }
  }

  const pseudo = await api.get('zone-settings', `/zones/${zoneId}/settings/pseudo_ipv4`);
  // Право Bot Management Read необов'язкове: без нього стан Bot Fight Mode лишається невідомим (null),
  // різниця його не чіпає, а plan і apply друкують попередження.
  /** @type {any} */
  let bot = null;
  let botKnown = true;
  try {
    bot = await api.get('bot-management', `/zones/${zoneId}/bot_management`);
  } catch (e) {
    if (e instanceof ApiRefusal && e.status === 403) botKnown = false;
    else throw e;
  }
  return {
    tunnels,
    dns,
    rulesets,
    zone: { pseudo_ipv4: pseudo?.value ?? null, bot_fight_mode: botKnown ? !!bot?.fight_mode : null },
  };
}

/**
 * Бажаний і поточний стан разом (F2): спершу бажаний без залишків адмінки, читання (зокрема записів DNS імен адмінки
 * без Access), далі — якщо ім’я адмінки без Access уже є в Cloudflare (запис DNS чи ingress тунелю) — бажаний стан
 * будується знову з цим ім’ям у блок-правилі. API Access не читається.
 * @param {{
 *   api: { get: (category: string, path: string) => Promise<any> },
 *   ids: { accountId: string, zoneId: string },
 *   build: (staleAdmin: string[]) => ReturnType<typeof import('./desired.mjs').desiredState>,
 *   watch: string[],
 *   redactor?: { add: (v: string | undefined) => void },
 * }} o `watch` — імена адмінки середовищ, де адмінку не ввімкнено
 */
export async function observe(o) {
  const first = o.build([]);
  const current = await readCurrent(o.api, o.ids, first, o.redactor, o.watch);
  const stale = o.watch.filter(
    (h) => current.dns.some((r) => r.name === h) || current.tunnels.some((t) => (t.ingress ?? []).some((i) => i?.hostname === h)),
  );
  return { desired: stale.length ? o.build(stale) : first, current, stale };
}
