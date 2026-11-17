// @ts-check
// Застосунок Cloudflare Access для адмінки середовища (`adminHost`). Працює лише з `--with-access`.
// Пошти власника — тільки зі змінної T2F_OWNER_EMAILS (локальний файл секретів), ніколи з git;
// у вивід потрапляє лише їх кількість. `aud` застосунку — не секрет, друкується для T2F_ACCESS_AUD.
import { ENVS } from './config.mjs';

/** Змінна з поштами власника (через кому, крапку з комою чи пробіл). */
export const OWNER_EMAILS_ENV = 'T2F_OWNER_EMAILS';

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/**
 * @param {string | undefined} raw
 * @returns {string[] | null} null — порожньо або щось не схоже на адресу
 */
export function parseOwnerEmails(raw) {
  const list = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length || !list.every((e) => EMAIL_RE.test(e))) return null;
  return [...new Set(list)];
}

/**
 * @typedef {{ name: string, domain: string, type: string, session_duration: string,
 *   policies: { name: string, decision: string, include: { email: { email: string } }[] }[] }} AccessApp
 */

/**
 * Бажаний застосунок Access для адмінки середовища.
 * @param {string} envName
 * @param {string[]} emails
 * @returns {AccessApp}
 */
export function desiredAccess(envName, emails) {
  const e = ENVS[envName];
  if (!e) throw new Error(`невідоме середовище: ${envName}`);
  if (!e.adminHost) throw new Error(`середовище ${envName} не має імені адмінки (adminHost): Access не потрібен`);
  return {
    name: `t2f-admin-${envName}`,
    domain: e.adminHost,
    type: 'self_hosted',
    session_duration: '24h',
    policies: [{ name: `t2f-owner-${envName}`, decision: 'allow', include: emails.map((email) => ({ email: { email } })) }],
  };
}

/** @param {any} a */
const view = (a) =>
  JSON.stringify({
    name: a?.name ?? '',
    domain: String(a?.domain ?? '').toLowerCase(),
    type: a?.type ?? '',
    session_duration: a?.session_duration ?? '',
    policies: (a?.policies ?? []).map((/** @type {any} */ p) => ({
      name: p?.name ?? '',
      decision: p?.decision ?? '',
      include: (p?.include ?? []).map((/** @type {any} */ i) => ({ email: { email: i?.email?.email ?? null } })),
    })),
  });

/**
 * Зміни застосунку Access: створити, якщо застосунку з цим `domain` немає; оновити, якщо відрізняється.
 * Підсумок називає лише кількість адрес, не самі адреси.
 * @param {AccessApp} app
 * @param {any[]} currentApps відповідь `GET /accounts/{a}/access/apps`
 * @returns {import('./diff.mjs').Change[]}
 */
export function diffAccess(app, currentApps) {
  const domain = app.domain.toLowerCase();
  const cur = currentApps.find((a) => String(a?.domain ?? '').toLowerCase().replace(/\/$/, '') === domain);
  const count = app.policies.reduce((n, p) => n + p.include.length, 0);
  const base = { kind: 'access-app', target: app.domain, hosts: [app.domain], category: 'access' };
  if (!cur) {
    return [{ ...base, op: 'create', summary: `Access ${app.name} (${app.domain}): створити, політика на ${count} адрес`, data: { app } }];
  }
  if (view(cur) !== view(app)) {
    return [{ ...base, op: 'update', summary: `Access ${app.name} (${app.domain}): оновити, політика на ${count} адрес`, data: { app, id: String(cur.id) } }];
  }
  return [];
}

/**
 * Крок Access для plan/apply: читання (GET) і застосування (POST/PUT).
 * @param {{
 *   api: { request: (method: string, category: string, path: string, body?: unknown) => Promise<any>, get: (category: string, path: string) => Promise<any> },
 *   accountId: string,
 *   app: AccessApp,
 *   out: (line: string) => void,
 * }} deps
 */
export function createAccessStep({ api, accountId, app, out }) {
  const base = `/accounts/${accountId}/access/apps`;
  return {
    /** @returns {Promise<import('./diff.mjs').Change[]>} */
    async changes() {
      const list = (await api.get('access', base)) ?? [];
      return diffAccess(app, Array.isArray(list) ? list : []);
    },
    /** @param {import('./diff.mjs').Change} change */
    async apply(change) {
      const d = change.data ?? {};
      const res =
        change.op === 'create'
          ? await api.request('POST', 'access', base, d.app)
          : await api.request('PUT', 'access', `${base}/${d.id}`, d.app);
      if (res?.aud) out(`Access ${app.name}: aud = ${String(res.aud)} → значення для T2F_ACCESS_AUD (не секрет)`);
    },
  };
}
