// @ts-check
// Cloudflare для спайку (план §7): рівно три ресурси — тунель `t2f-rtspike` (керований віддалено), запис CNAME
// `rt-spike` → тунель (проксі) і ОДНЕ конфіг-правило фази `http_config_settings`, додане окремим запитом
// (`POST …/rulesets/{id}/rules`), ніколи не `PUT` усього переліку. Кожен змінний запит проходить `guard`: дозволено
// лише ці шляхи й лише з id, які щойно прочитано й звірено за ім’ям/виразом. Токен тунелю не друкується й не пишеться
// локально — лише в env-файл cloudflared вузла realtime (через `deliverToken`).
import { createApi } from '../../../cloudflare/lib/api.mjs';
import { CF, CF_ENV } from './config.mjs';

/** Відмова до зміни: ресурс не спайку або шлях поза дозволеним. */
export class SpikeRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SpikeRefusal';
  }
}

/**
 * @typedef {ReturnType<typeof createApi>} Api
 * @typedef {{ tunnelId: string | null, recordId: string | null, entrypointId: string | null, ruleIds: string[] }} Known
 * @typedef {{
 *   tunnel: { id: string, name: string, connections: number } | null,
 *   record: { id: string, name: string, type: string, content: string, proxied: boolean } | null,
 *   entrypoint: { id: string, rules: any[] } | null,
 *   spikeRules: any[],
 *   otherRules: number,
 * }} SpikeState
 */

/**
 * Клієнт API з облікових даних (назви — `CF_ENV`); `null`, якщо чогось бракує.
 * @param {Record<string, string | undefined>} env
 * @param {typeof globalThis.fetch} fetch
 */
export function apiFrom(env, fetch) {
  const missing = Object.values(CF_ENV).filter((n) => !env[n]);
  if (missing.length) return { missing, api: null, account: '', zone: '' };
  return { missing, api: createApi({ env, fetch }), account: String(env[CF_ENV.account]), zone: String(env[CF_ENV.zone]) };
}

/**
 * Запобіжник змінних запитів: лише ресурси спайку з уже звіреними id.
 * @param {string} method
 * @param {string} path
 * @param {any} body
 * @param {{ account: string, zone: string }} ids
 * @param {Known} known
 */
export function checkMutation(method, path, body, ids, known) {
  const a = `/accounts/${ids.account}`;
  const z = `/zones/${ids.zone}`;
  const t = known.tunnelId;
  const ok =
    (method === 'POST' && path === `${a}/cfd_tunnel` && body?.name === CF.tunnelName && body?.config_src === 'cloudflare') ||
    (method === 'PUT' && t !== null && path === `${a}/cfd_tunnel/${t}/configurations`) ||
    (method === 'DELETE' && t !== null && (path === `${a}/cfd_tunnel/${t}/connections` || path === `${a}/cfd_tunnel/${t}`)) ||
    (method === 'POST' && t !== null && path === `${z}/dns_records` && body?.name === CF.host && body?.type === 'CNAME' && body?.content === `${t}.cfargotunnel.com` && body?.proxied === true) ||
    (method === 'DELETE' && known.recordId !== null && path === `${z}/dns_records/${known.recordId}`) ||
    (method === 'POST' && known.entrypointId !== null && path === `${z}/rulesets/${known.entrypointId}/rules` && isSpikeRule(body)) ||
    (method === 'DELETE' && known.entrypointId !== null && known.ruleIds.some((r) => path === `${z}/rulesets/${known.entrypointId}/rules/${r}`));
  if (!ok) throw new SpikeRefusal(`запит ${method} ${path.split('?')[0]} — не ресурс спайку; відмова`);
}

/** Правило спайку: опис з префіксом і рівно наш вираз. @param {any} r */
export const isSpikeRule = (r) => typeof r?.description === 'string' && r.description.startsWith(CF.rulePrefix) && r?.expression === CF.ruleExpression;

/**
 * Обгортка API: читання — як є; кожна зміна — через `checkMutation`.
 * @param {Api} api
 * @param {{ account: string, zone: string }} ids
 * @param {Known} known
 */
export function guarded(api, ids, known) {
  return {
    /** @param {string} category @param {string} path */
    get: (category, path) => api.get(category, path),
    /** @param {string} method @param {string} category @param {string} path @param {unknown} [body] */
    mutate(method, category, path, body) {
      checkMutation(method, path, body, ids, known);
      return api.request(method, category, path, body);
    },
  };
}

/**
 * Стан ресурсів спайку в Cloudflare (лише читання). Чужий ресурс з нашим ім’ям — відмова.
 * @param {Api} api
 * @param {{ account: string, zone: string }} ids
 * @returns {Promise<SpikeState>}
 */
export async function readState(api, ids) {
  const tunnels = ((await api.get('tunnel', `/accounts/${ids.account}/cfd_tunnel?name=${encodeURIComponent(CF.tunnelName)}&is_deleted=false`)) ?? []).filter(
    (/** @type {any} */ x) => x?.name === CF.tunnelName && !x?.deleted_at,
  );
  if (tunnels.length > 1) throw new SpikeRefusal(`тунелів з ім’ям ${CF.tunnelName} кілька (${tunnels.length}) — розберіться вручну`);
  const tunnel = tunnels[0]
    ? { id: String(tunnels[0].id), name: CF.tunnelName, connections: Array.isArray(tunnels[0].connections) ? tunnels[0].connections.length : 0 }
    : null;

  const records = ((await api.get('dns', `/zones/${ids.zone}/dns_records?name=${encodeURIComponent(CF.host)}`)) ?? []).filter((/** @type {any} */ r) => r?.name === CF.host);
  if (records.length > 1) throw new SpikeRefusal(`записів DNS ${CF.host} кілька — розберіться вручну`);
  /** @type {SpikeState['record']} */
  let record = null;
  if (records[0]) {
    const r = records[0];
    record = { id: String(r.id), name: CF.host, type: String(r.type), content: String(r.content ?? ''), proxied: r.proxied === true };
    if (record.type !== 'CNAME' || !record.content.endsWith('.cfargotunnel.com')) {
      throw new SpikeRefusal(`запис ${CF.host} є, але не CNAME на тунель — чужий, не чіпаю`);
    }
    if (tunnel && record.content !== `${tunnel.id}.cfargotunnel.com`) throw new SpikeRefusal(`запис ${CF.host} веде на інший тунель — не чіпаю`);
  }

  /** @type {SpikeState['entrypoint']} */
  let entrypoint = null;
  try {
    const rs = await api.get('config-rules', `/zones/${ids.zone}/rulesets/phases/${CF.phase}/entrypoint`);
    if (rs?.id) entrypoint = { id: String(rs.id), rules: Array.isArray(rs.rules) ? rs.rules : [] };
  } catch (e) {
    if (!(e instanceof Error && 'status' in e && e.status === 404)) throw e;
  }
  const rules = entrypoint?.rules ?? [];
  const mentions = rules.filter((r) => String(r?.expression ?? '').includes(CF.host) || String(r?.description ?? '').startsWith(CF.rulePrefix));
  const foreign = mentions.filter((r) => !isSpikeRule(r));
  if (foreign.length) throw new SpikeRefusal(`у фазі ${CF.phase} є правило про ${CF.host}, яке не збігається з правилом спайку — не чіпаю`);
  const spikeRules = mentions;
  return { tunnel, record, entrypoint, spikeRules, otherRules: rules.length - spikeRules.length };
}

/** @param {SpikeState} s @returns {Known} */
const knownOf = (s) => ({
  tunnelId: s.tunnel?.id ?? null,
  recordId: s.record?.id ?? null,
  entrypointId: s.entrypoint?.id ?? null,
  ruleIds: s.spikeRules.map((r) => String(r.id)),
});

const INGRESS = [{ hostname: CF.host, path: CF.ingressPath, service: CF.service }, { service: 'http_status:404' }];

/**
 * `cf-up`: створює відсутнє з трьох ресурсів (повтор безпечний), віддає токен тунелю в `deliverToken`.
 * @param {{ api: Api, ids: { account: string, zone: string }, out: (l: string) => void, register: (secret: string) => void, deliverToken: (token: string) => Promise<void> }} o
 * @returns {Promise<{ tunnelId: string, recordId: string, ruleId: string, rulesBefore: number, created: string[] }>}
 */
export async function cfUp(o) {
  const { api, ids, out } = o;
  const before = await readState(api, ids);
  if (!before.entrypoint) throw new SpikeRefusal(`фази ${CF.phase} у зоні немає — правило не додаю (створювати фазу PUT-ом спайк не має права)`);
  const known = knownOf(before);
  const g = guarded(api, ids, known);
  /** @type {string[]} */
  const created = [];

  let tunnelId = before.tunnel?.id ?? null;
  if (!tunnelId) {
    const res = await g.mutate('POST', 'tunnel', `/accounts/${ids.account}/cfd_tunnel`, { name: CF.tunnelName, config_src: 'cloudflare' });
    tunnelId = String(res?.id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(tunnelId)) throw new Error('тунель створено, але id не прочитано');
    created.push('tunnel');
    out(`cf-up: тунель ${CF.tunnelName} створено (${tunnelId})`);
  } else out(`cf-up: тунель ${CF.tunnelName} уже є (${tunnelId})`);
  known.tunnelId = tunnelId;
  const cfg = await api.get('tunnel', `/accounts/${ids.account}/cfd_tunnel/${tunnelId}/configurations`);
  if (JSON.stringify(cfg?.config?.ingress ?? null) !== JSON.stringify(INGRESS)) {
    await g.mutate('PUT', 'tunnel', `/accounts/${ids.account}/cfd_tunnel/${tunnelId}/configurations`, { config: { ingress: INGRESS } });
    out(`cf-up: ingress ${CF.host} ${CF.ingressPath} → ${CF.service}, решта 404`);
  }

  let recordId = before.record?.id ?? null;
  if (!recordId) {
    const res = await g.mutate('POST', 'dns', `/zones/${ids.zone}/dns_records`, { type: 'CNAME', name: CF.host, content: `${tunnelId}.cfargotunnel.com`, proxied: true });
    recordId = String(res?.id ?? '');
    created.push('dns');
    out(`cf-up: CNAME ${CF.host} → тунель (проксі) створено`);
  } else out(`cf-up: CNAME ${CF.host} уже є`);

  let ruleId = before.spikeRules[0]?.id ? String(before.spikeRules[0].id) : null;
  if (!ruleId) {
    const res = await g.mutate('POST', 'config-rules', `/zones/${ids.zone}/rulesets/${before.entrypoint.id}/rules`, {
      description: CF.ruleDescription,
      expression: CF.ruleExpression,
      action: 'set_config',
      action_parameters: { security_level: 'essentially_off', bic: false },
      enabled: true,
    });
    // Відповідь — увесь набір правил; наше — за описом і виразом.
    const rule = (Array.isArray(res?.rules) ? res.rules : []).find(isSpikeRule);
    ruleId = rule?.id ? String(rule.id) : '';
    created.push('rule');
    out(`cf-up: конфіг-правило спайку додано (було правил у фазі: ${before.otherRules})`);
  } else out('cf-up: конфіг-правило спайку вже є');

  const token = await api.get('tunnel', `/accounts/${ids.account}/cfd_tunnel/${tunnelId}/token`);
  if (typeof token !== 'string' || token.length < 20) throw new Error('токен тунелю не прочитано');
  o.register(token);
  await o.deliverToken(token);
  out('cf-up: токен тунелю записано в cloudflared.env вузла realtime (не друкується)');
  return { tunnelId, recordId, ruleId, rulesBefore: before.otherRules, created };
}

/**
 * `cf-down`: видаляє рівно три ресурси спайку (правило, запис, тунель — після очищення з’єднань) і звіряє, що в фазі
 * лишилося стільки правил, скільки було до `cf-up`.
 * @param {{ api: Api, ids: { account: string, zone: string }, out: (l: string) => void, stopConnectors: () => Promise<void>, rulesBefore: number | null }} o
 * @returns {Promise<{ removed: string[], rulesAfter: number }>}
 */
export async function cfDown(o) {
  const { api, ids, out } = o;
  const s = await readState(api, ids);
  const known = knownOf(s);
  const g = guarded(api, ids, known);
  /** @type {string[]} */
  const removed = [];
  for (const r of s.spikeRules) {
    await g.mutate('DELETE', 'config-rules', `/zones/${ids.zone}/rulesets/${known.entrypointId}/rules/${r.id}`);
    removed.push('rule');
    out('cf-down: конфіг-правило спайку видалено');
  }
  if (s.record) {
    await g.mutate('DELETE', 'dns', `/zones/${ids.zone}/dns_records/${s.record.id}`);
    removed.push('dns');
    out(`cf-down: запис ${CF.host} видалено`);
  }
  if (s.tunnel) {
    await o.stopConnectors();
    await g.mutate('DELETE', 'tunnel', `/accounts/${ids.account}/cfd_tunnel/${s.tunnel.id}/connections`);
    await g.mutate('DELETE', 'tunnel', `/accounts/${ids.account}/cfd_tunnel/${s.tunnel.id}`);
    removed.push('tunnel');
    out(`cf-down: тунель ${CF.tunnelName} видалено`);
  }
  const after = await readState(api, ids);
  const left = [after.tunnel ? 'тунель' : '', after.record ? 'запис DNS' : '', after.spikeRules.length ? 'правило' : ''].filter(Boolean);
  if (left.length) throw new Error(`cf-down: лишилося: ${left.join(', ')}`);
  const rulesAfter = after.entrypoint?.rules.length ?? 0;
  if (o.rulesBefore !== null && rulesAfter !== o.rulesBefore) throw new Error(`cf-down: у фазі ${CF.phase} ${rulesAfter} правил, до cf-up було ${o.rulesBefore}`);
  out(`cf-down: перевірено — тунелю, запису й правила спайку немає; правил у фазі ${rulesAfter}${o.rulesBefore !== null ? ` (як до cf-up)` : ''}`);
  return { removed, rulesAfter };
}

/**
 * `cf-status`: лише читання.
 * @param {{ api: Api, ids: { account: string, zone: string }, out: (l: string) => void }} o
 */
export async function cfStatus(o) {
  const s = await readState(o.api, o.ids);
  o.out(`cf-status: тунель ${CF.tunnelName}: ${s.tunnel ? `є (${s.tunnel.id}), з’єднань ${s.tunnel.connections}` : 'немає'}`);
  o.out(`cf-status: запис ${CF.host}: ${s.record ? `${s.record.type} → ${s.record.content}${s.record.proxied ? ', проксі' : ', БЕЗ проксі'}` : 'немає'}`);
  o.out(`cf-status: фаза ${CF.phase}: правил ${s.entrypoint?.rules.length ?? 0}, з них спайку ${s.spikeRules.length}`);
  return s;
}
