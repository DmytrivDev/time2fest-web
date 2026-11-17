// @ts-check
// `apply`: під замком `cloudflare` читає поточний стан, рахує різницю, перевіряє запобіжником і застосовує
// зміни по порядку: тунель → ingress → DNS → набори правил (повний список фази) → налаштування зони (лише з прапорцем).
// Перша відмова зупиняє все; вивід називає дозвіл і вже застосовані зміни.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire, lockDir } from '../../../server/scripts/lib/lock.mjs';
import { resolveWorktree } from '../../../server/scripts/lib/worktree.mjs';
import { ApiRefusal } from './api.mjs';
import { readCurrent } from './current.mjs';
import { diff } from './diff.mjs';
import { describeRefusals, guard } from './guard.mjs';
import { tokenFileExists, writeTokenFile } from './tokenFile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Порядок виконання за видом зміни. */
const ORDER = /** @type {Record<string, number>} */ ({ tunnel: 0, 'tunnel-config': 1, dns: 2, rule: 3, 'zone-setting': 4, 'access-app': 5 });

/** Дозвіл токена, потрібний для категорії запиту. */
const EDIT_PERMISSION = /** @type {Record<string, string>} */ ({
  tunnel: 'Account · Cloudflare Tunnel · Edit',
  dns: 'Zone · DNS · Edit',
  waf: 'Zone · Zone WAF · Edit',
  'config-rules': 'Zone · Config Rules · Edit',
  'zone-settings': 'Zone · Zone Settings · Edit',
  'bot-management': 'Zone · Bot Management · Edit',
  access: 'Account · Access: Apps and Policies · Edit',
});

/**
 * @param {string} category
 * @param {string} method
 */
export function permissionFor(category, method) {
  const edit = EDIT_PERMISSION[category] ?? `${category} · Edit`;
  return method === 'GET' ? edit.replace(/ · Edit$/, ' · Read') : edit;
}

/**
 * Замок `cloudflare` механізму `server/scripts/lib/lock.mjs` (тека `<lockDir>/cloudflare`, виключний режим).
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ release: () => Promise<void> }>}
 */
export async function takeCloudflareLock(env) {
  let slug = 'infra';
  try {
    slug = resolveWorktree(REPO_ROOT, env).slug;
  } catch {
    // Поза git-деревом — лише позначка власника; сам замок від цього не залежить.
  }
  return acquire({ dir: path.join(lockDir(REPO_ROOT, env), 'cloudflare'), owner: `${slug}:${process.pid}`, mode: 'exclusive', env });
}

/** @param {Date} d */
function ymd(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * @typedef {{
 *   api: { request: (method: string, category: string, path: string, body?: unknown) => Promise<any>, get: (category: string, path: string) => Promise<any> },
 *   ids: { accountId: string, zoneId: string },
 *   envName: string,
 *   desired: ReturnType<typeof import('./desired.mjs').desiredState>,
 *   flags: import('./guard.mjs').GuardFlags,
 *   redactor: { add: (v: string | undefined) => void },
 *   out: (line: string) => void,
 *   now: () => Date,
 *   localDir: string,
 *   acquireLock: () => Promise<{ release: () => Promise<void> }>,
 *   access?: { changes: () => Promise<import('./diff.mjs').Change[]>, apply: (c: import('./diff.mjs').Change) => Promise<void> },
 * }} ApplyContext `access` — лише з `--with-access` (lib/access.mjs)
 */

/**
 * @param {ApplyContext} ctx
 * @returns {Promise<number>} 0 — успіх; 2 — запобіжник відмовив (0 запитів на зміну); 3 — зупинено на відмові API
 */
export async function runApply(ctx) {
  const { out } = ctx;
  const lock = await ctx.acquireLock();
  /** @type {string[]} */
  const applied = [];
  try {
    // Читання під замком: другий apply бачить результат першого.
    const current = await readCurrent(ctx.api, ctx.ids, ctx.desired, ctx.redactor);
    if (current.zone.bot_fight_mode === null) out('Bot Fight Mode: стан не перевірено (токен без права Zone · Bot Management · Read)');
    const changes = diff(ctx.desired, current);
    if (ctx.access) changes.push(...(await ctx.access.changes()));

    const verdict = guard(changes, ctx.flags);
    if (!verdict.ok) {
      for (const line of describeRefusals(verdict.refused)) out(line);
      out('apply зупинено запобіжником: жодного запиту на зміну не зроблено');
      return 2;
    }

    const tunnelIds = new Map(current.tunnels.map((t) => [t.name, t.id]));
    if (!changes.length) {
      out('без змін');
    } else {
      await execute(ctx, changes, tunnelIds, applied);
    }

    await ensureTokenFile(ctx, tunnelIds);

    if (applied.length) out(`- ${ymd(ctx.now())} — infra/cloudflare apply (${ctx.envName}): ${applied.join('; ')}`);
    return 0;
  } catch (e) {
    if (e instanceof ApiRefusal) {
      out(`refused ${e.status} on ${e.category} ${e.method} ${e.path}; needs permission: ${permissionFor(e.category, e.method)}`);
    } else {
      out(`stopped on error: ${e instanceof Error ? e.message : String(e)}`);
    }
    out('applied before the refusal:');
    if (applied.length) for (const a of applied) out(`  - ${a}`);
    else out('  (нічого)');
    return 3;
  } finally {
    await lock.release();
  }
}

/**
 * @param {ApplyContext} ctx
 * @param {import('./diff.mjs').Change[]} changes
 * @param {Map<string, string>} tunnelIds
 * @param {string[]} applied
 */
async function execute(ctx, changes, tunnelIds, applied) {
  const { api, out } = ctx;
  const { accountId: a, zoneId: z } = ctx.ids;
  const ordered = [...changes].sort((x, y) => (ORDER[x.kind] ?? 99) - (ORDER[y.kind] ?? 99));
  /** @type {Set<string>} */
  const phasesDone = new Set();
  /** @param {import('./diff.mjs').Change} c */
  const done = (c) => {
    applied.push(c.summary);
    out(`${c.op.padEnd(6)} ${c.kind}: ${c.summary} — застосовано`);
  };

  for (const c of ordered) {
    const d = c.data ?? {};
    if (c.kind === 'tunnel' && c.op === 'create') {
      const res = await api.request('POST', 'tunnel', `/accounts/${a}/cfd_tunnel`, { name: d.name, config_src: 'cloudflare' });
      ctx.redactor.add(typeof res?.token === 'string' ? res.token : undefined);
      const id = res?.id ? String(res.id) : '';
      if (!id) throw new Error(`Cloudflare не повернув id тунелю ${d.name}`);
      tunnelIds.set(d.name, id);
      applied.push(`тунель ${d.name}: створено (ingress ще не записано)`);
      await api.request('PUT', 'tunnel', `/accounts/${a}/cfd_tunnel/${id}/configurations`, { config: { ingress: d.ingress } });
      applied.pop();
      done(c);
    } else if (c.kind === 'tunnel-config' && c.op === 'update') {
      await api.request('PUT', 'tunnel', `/accounts/${a}/cfd_tunnel/${d.tunnelId}/configurations`, { config: { ingress: d.ingress } });
      done(c);
    } else if (c.kind === 'dns' && (c.op === 'create' || c.op === 'update')) {
      const id = tunnelIds.get(d.tunnelName);
      if (!id) throw new Error(`немає тунелю ${d.tunnelName} для DNS ${d.name}`);
      const record = { type: d.type, name: d.name, content: `${id}.cfargotunnel.com`, proxied: d.proxied };
      if (c.op === 'create') await api.request('POST', 'dns', `/zones/${z}/dns_records`, record);
      else await api.request('PATCH', 'dns', `/zones/${z}/dns_records/${d.id}`, record);
      done(c);
    } else if (c.kind === 'rule') {
      const phase = String(d.phase);
      if (!phasesDone.has(phase)) {
        // PUT замінює весь список фази бажаним — ідемпотентно; зайві правила зникають лише з --allow-delete.
        const rules = ctx.desired.rulesets[phase];
        if (!rules) throw new Error(`немає бажаного списку для фази ${phase}`);
        await api.request('PUT', c.category, `/zones/${z}/rulesets/phases/${phase}/entrypoint`, { rules });
        phasesDone.add(phase);
      }
      done(c);
    } else if (c.kind === 'zone-setting' && c.op === 'update') {
      if (!ctx.flags.allowZoneSettings) throw new Error('налаштування зони без --allow-zone-settings');
      if (d.setting === 'pseudo_ipv4') {
        await api.request('PATCH', 'zone-settings', `/zones/${z}/settings/pseudo_ipv4`, { value: d.value });
      } else if (d.setting === 'bot_fight_mode') {
        await api.request('PUT', 'bot-management', `/zones/${z}/bot_management`, { fight_mode: !!d.value });
      } else {
        throw new Error(`невідоме налаштування зони ${String(d.setting)}`);
      }
      done(c);
    } else if (c.kind === 'access-app' && ctx.access && (c.op === 'create' || c.op === 'update')) {
      await ctx.access.apply(c);
      done(c);
    } else {
      throw new Error(`невідома зміна ${c.op} ${c.kind}`);
    }
  }
}

/**
 * Якщо файлу токена ще немає — бере токен тунелю середовища й пише його в `.local/` (0600). Токен не друкується.
 * @param {ApplyContext} ctx
 * @param {Map<string, string>} tunnelIds
 */
async function ensureTokenFile(ctx, tunnelIds) {
  if (tokenFileExists(ctx.localDir, ctx.envName)) return;
  const tunnel = ctx.desired.tunnels.find((t) => t.env === ctx.envName);
  const id = tunnel ? tunnelIds.get(tunnel.name) : undefined;
  if (!tunnel || !id) throw new Error(`тунель середовища ${ctx.envName} не знайдено; файл токена не записано`);
  const token = await ctx.api.get('tunnel', `/accounts/${ctx.ids.accountId}/cfd_tunnel/${id}/token`);
  ctx.redactor.add(typeof token === 'string' ? token : undefined);
  const file = writeTokenFile(ctx.localDir, ctx.envName, token);
  ctx.out(`токен тунелю записано у ${file} (0600, поза git; значення не друкується)`);
}
