// @ts-check
// Застосунок Cloudflare Access для адмінки середовища (`adminHost`). Працює лише з `--with-access`.
// Пошти власника — тільки зі змінної T2F_OWNER_EMAILS (локальний файл секретів), ніколи з git;
// у вивід потрапляє лише їх кількість. `aud` застосунку — не секрет, друкується для T2F_ACCESS_AUD.
// Вхід — лише через Google (постачальник `t2f-google`, рівень акаунта): застосунок має `allowed_idps` = його id і
// `auto_redirect_to_identity`, тож одноразовий PIN поштою не пропонується. Секрет клієнта Google ніколи не друкується
// і не повертається API у відкритому вигляді; client id — лише останні 6 символів.
import { ApiRefusal } from './api.mjs';
import { ENVS } from './config.mjs';

/** Змінна з поштами власника (через кому, крапку з комою чи пробіл). */
export const OWNER_EMAILS_ENV = 'T2F_OWNER_EMAILS';
/** Право на читання застосунків Access (перевірка позначки `access-<env>.ok`). */
export const ACCESS_READ_RIGHT = 'Account · Access: Apps and Policies · Read';

/**
 * @typedef {{
 *   request: (method: string, category: string, path: string, body?: unknown) => Promise<any>,
 *   get: (category: string, path: string) => Promise<any>,
 *   getAll: (category: string, path: string) => Promise<any[]>,
 * }} AccessApi
 */

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

/** Ім’я й тип постачальника входу, яким керує скрипт. */
export const IDP_NAME = 't2f-google';
export const IDP_TYPE = 'google';
/** Право токена на постачальників входу (і на читання списку: крок їх створює чи оновлює). */
export const IDP_RIGHT = 'Account · Access: Organizations, Identity Providers, and Groups · Edit';
/** Право на читання постачальників входу (перевірка позначки `access-<env>.ok`, S8). */
export const IDP_READ_RIGHT = 'Account · Access: Organizations, Identity Providers, and Groups · Read';
/** Заповнювач id постачальника, якого ще створить цей же запуск (лише для порівняння). */
const PENDING_IDP = '<new t2f-google>';

/**
 * @typedef {{ name: string, domain: string, type: string, session_duration: string,
 *   policies: { name: string, decision: string, include: { email: { email: string } }[] }[] }} AccessApp
 * @typedef {{ clientId: string, clientSecret: string }} GoogleClient
 */

/** @param {string} clientId */
export const clientIdTail = (clientId) => `…${String(clientId).slice(-6)}`;

/**
 * Тіло застосунку для API: бажаний застосунок плюс єдиний дозволений спосіб входу.
 * @param {AccessApp} app
 * @param {string} idpId
 */
export const appBody = (app, idpId) => ({ ...app, allowed_idps: [idpId], auto_redirect_to_identity: true });

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
    allowed_idps: [...(Array.isArray(a?.allowed_idps) ? a.allowed_idps : [])].map(String).sort(),
    auto_redirect_to_identity: a?.auto_redirect_to_identity === true,
    policies: (a?.policies ?? []).map((/** @type {any} */ p) => ({
      name: p?.name ?? '',
      decision: p?.decision ?? '',
      include: (p?.include ?? []).map((/** @type {any} */ i) => ({ email: { email: i?.email?.email ?? null } })),
    })),
  });

/** @param {unknown} d */
const domainOf = (d) => String(d ?? '').toLowerCase().replace(/\/$/, '');

/**
 * Усі застосунки Access акаунта (усі сторінки).
 * @param {AccessApi} api
 * @param {string} accountId
 */
export async function listAccessApps(api, accountId) {
  return api.getAll('access', `/accounts/${accountId}/access/apps`);
}

/** Правило `include` лише з поштою: `{ email: { email: "<адреса>" } }` і нічого більше. @param {any} rule */
const emailOnly = (rule) =>
  rule !== null && typeof rule === 'object' && Object.keys(rule).length === 1 && typeof rule.email?.email === 'string' && rule.email.email !== '';

/**
 * Перевірка позначки (N3, S8): адмінка лишається ввімкненою лише тоді, коли в Cloudflare справді є застосунок Access з
 * `domain` = ім’я адмінки, хоча б однією політикою `allow`, у кожній політиці `allow` — лише правила `include` з поштою, і
 * `allowed_idps` рівно з одного id — постачальника `t2f-google` типу `google`. Бракує права читання (застосунків чи
 * постачальників) — теж «вимкнено» (не перевірено), без збою всього запуску, з назвою права; інша відмова API — виняток.
 * @param {AccessApi} api
 * @param {string} accountId
 * @param {string} host
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing' | 'no-policy' | 'not-email' | 'no-idp' } | { ok: false, reason: 'no-right', right: string }>}
 */
export async function verifyAdminAccess(api, accountId, host) {
  /** @param {unknown} e */
  const refused = (e) => e instanceof ApiRefusal && (e.status === 401 || e.status === 403);
  /** @type {any[]} */
  let apps;
  try {
    apps = await listAccessApps(api, accountId);
  } catch (e) {
    if (refused(e)) return { ok: false, reason: 'no-right', right: ACCESS_READ_RIGHT };
    throw e;
  }
  const mine = apps.filter((a) => domainOf(a?.domain) === host.toLowerCase());
  if (!mine.length) return { ok: false, reason: 'missing' };
  /** @param {any} a */
  const allows = (a) => (Array.isArray(a?.policies) ? a.policies : []).filter((/** @type {any} */ p) => p?.decision === 'allow');
  const withPolicy = mine.filter((a) => allows(a).length > 0);
  if (!withPolicy.length) return { ok: false, reason: 'no-policy' };
  const emailPolicies = withPolicy.filter((a) =>
    allows(a).every((/** @type {any} */ p) => Array.isArray(p?.include) && p.include.length > 0 && p.include.every(emailOnly)),
  );
  if (!emailPolicies.length) return { ok: false, reason: 'not-email' };
  /** @type {any[]} */
  let idps;
  try {
    idps = await api.getAll('access-idp', `/accounts/${accountId}/access/identity_providers`);
  } catch (e) {
    if (refused(e)) return { ok: false, reason: 'no-right', right: IDP_READ_RIGHT };
    throw e;
  }
  const google = idps.filter((p) => p?.name === IDP_NAME && p?.type === IDP_TYPE && p?.id !== undefined && p?.id !== null);
  if (google.length !== 1) return { ok: false, reason: 'no-idp' };
  const id = String(google[0].id);
  /** @param {any} a */
  const onlyGoogle = (a) => Array.isArray(a?.allowed_idps) && a.allowed_idps.length === 1 && String(a.allowed_idps[0]) === id;
  return emailPolicies.some(onlyGoogle) ? { ok: true } : { ok: false, reason: 'no-idp' };
}

/**
 * Зміна постачальника входу Google: створити, якщо `t2f-google` немає; оновити (PUT), якщо client id інший.
 * Той самий client id — без змін (секрет API назад не віддає, порівняти його не можна). Постачальник з цим ім’ям
 * іншого типу — чужий: зміна з `data.conflict`, яку запобіжник відхиляє (скрипт його не змінює й не видаляє).
 * @param {{ envName: string, host: string, clientId: string }} want
 * @param {any[]} currentIdps відповідь `GET /accounts/{a}/access/identity_providers`
 * @returns {{ changes: import('./diff.mjs').Change[], id: string | null }} `id` — наявного постачальника Google
 */
export function diffIdp({ envName, host, clientId }, currentIdps) {
  const named = currentIdps.filter((p) => p?.name === IDP_NAME);
  /** @type {{ kind: string, target: string, hosts: string[], category: string }} */
  const base = { kind: 'access-idp', target: IDP_NAME, hosts: [host], category: 'access-idp' };
  const foreign = named.find((p) => p?.type !== IDP_TYPE);
  if (foreign) {
    const type = String(foreign?.type ?? '?');
    const summary = `постачальник входу ${IDP_NAME}: є з типом «${type}» — чужий, скрипт його не змінює`;
    return { changes: [{ ...base, op: 'update', summary, data: { env: envName, conflict: type } }], id: null };
  }
  const cur = named[0];
  const tail = clientIdTail(clientId);
  if (!cur) {
    return { changes: [{ ...base, op: 'create', summary: `постачальник входу ${IDP_NAME} (Google, client id ${tail}): створити`, data: { env: envName } }], id: null };
  }
  const id = String(cur.id);
  if (String(cur?.config?.client_id ?? '') !== clientId) {
    return { changes: [{ ...base, op: 'update', summary: `постачальник входу ${IDP_NAME} (Google): оновити client id на ${tail}`, data: { env: envName, id } }], id };
  }
  return { changes: [], id };
}

/**
 * Зміни застосунку Access: створити, якщо застосунку з цим `domain` немає; оновити, якщо відрізняється (зокрема
 * `allowed_idps` чи `auto_redirect_to_identity`). Підсумок називає лише кількість адрес, не самі адреси.
 * @param {AccessApp} app
 * @param {any[]} currentApps відповідь `GET /accounts/{a}/access/apps`
 * @param {string | null} [idpId] id постачальника Google; null — його створить цей же запуск
 * @returns {import('./diff.mjs').Change[]}
 */
export function diffAccess(app, currentApps, idpId = null) {
  const domain = app.domain.toLowerCase();
  const cur = currentApps.find((a) => domainOf(a?.domain) === domain);
  const count = app.policies.reduce((n, p) => n + p.include.length, 0);
  const base = { kind: 'access-app', target: app.domain, hosts: [app.domain], category: 'access' };
  if (!cur) {
    return [{ ...base, op: 'create', summary: `Access ${app.name} (${app.domain}): створити, політика на ${count} адрес, вхід лише через Google`, data: { app } }];
  }
  if (view(cur) !== view(appBody(app, idpId ?? PENDING_IDP))) {
    return [{ ...base, op: 'update', summary: `Access ${app.name} (${app.domain}): оновити, політика на ${count} адрес`, data: { app, id: String(cur.id) } }];
  }
  return [];
}

/**
 * Крок Access для plan/apply: читання (GET постачальників, потім застосунків) і застосування — постачальник Google
 * (POST/PUT), потім застосунок (POST/PUT) з `allowed_idps` = id постачальника.
 * @param {{
 *   api: AccessApi,
 *   accountId: string,
 *   envName: string,
 *   app: AccessApp,
 *   google: GoogleClient,
 *   out: (line: string) => void,
 * }} deps
 */
export function createAccessStep({ api, accountId, envName, app, google, out }) {
  const base = `/accounts/${accountId}/access/apps`;
  const idpBase = `/accounts/${accountId}/access/identity_providers`;
  /** id постачальника Google: наявного (з `changes`) або щойно створеного (з `apply`). @type {string | null} */
  let idpId = null;
  const idpBody = () => ({ name: IDP_NAME, type: IDP_TYPE, config: { client_id: google.clientId, client_secret: google.clientSecret } });
  return {
    /** @returns {Promise<import('./diff.mjs').Change[]>} */
    async changes() {
      const idp = diffIdp({ envName, host: app.domain, clientId: google.clientId }, await api.getAll('access-idp', idpBase));
      idpId = idp.id;
      return [...idp.changes, ...diffAccess(app, await listAccessApps(api, accountId), idpId)];
    },
    /** @param {import('./diff.mjs').Change} change */
    async apply(change) {
      const d = change.data ?? {};
      if (change.kind === 'access-idp') {
        if (d.conflict) throw new Error(`постачальник входу ${IDP_NAME} іншого типу — скрипт його не змінює`);
        if (change.op === 'create') {
          const res = await api.request('POST', 'access-idp', idpBase, idpBody());
          if (!res?.id) throw new Error(`Cloudflare не повернув id постачальника входу ${IDP_NAME}`);
          idpId = String(res.id);
        } else {
          await api.request('PUT', 'access-idp', `${idpBase}/${d.id}`, idpBody());
          idpId = String(d.id);
        }
        return;
      }
      if (!idpId) throw new Error(`немає id постачальника входу ${IDP_NAME}: застосунок Access не записано`);
      const body = appBody(d.app, idpId);
      const res = change.op === 'create' ? await api.request('POST', 'access', base, body) : await api.request('PUT', 'access', `${base}/${d.id}`, body);
      if (res?.aud) out(`Access ${app.name}: aud = ${String(res.aud)} → значення для T2F_ACCESS_AUD (не секрет)`);
    },
  };
}
