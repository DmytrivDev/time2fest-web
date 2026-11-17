// @ts-check
import { ApiRefusal } from './api.mjs';
import { PHASE_CONFIG, PHASE_CUSTOM } from './config.mjs';

/**
 * Читає поточний стан (лише GET).
 * @param {{ get: (category: string, path: string) => Promise<any> }} api
 * @param {{ accountId: string, zoneId: string }} ids
 * @param {{ tunnels: { name: string }[], dns: { name: string }[] }} desired
 * @param {{ add: (v: string | undefined) => void }} [redactor] отримує токени тунелів, що трапились у відповідях
 */
export async function readCurrent(api, { accountId, zoneId }, desired, redactor) {
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
  for (const d of desired.dns) {
    const list = (await api.get('dns', `/zones/${zoneId}/dns_records?name=${q(d.name)}`)) ?? [];
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
  const bot = await api.get('bot-management', `/zones/${zoneId}/bot_management`);
  return {
    tunnels,
    dns,
    rulesets,
    zone: { pseudo_ipv4: pseudo?.value ?? null, bot_fight_mode: !!bot?.fight_mode },
  };
}
