// @ts-check
// Адаптер DigitalOcean до інтерфейсу провайдера (AC-45). Токен — лише з `DIGITALOCEAN_API_TOKEN`, ніколи не друкується;
// базова адреса — справжній API або loopback у тестах. Відмова API — `ProviderError` без тіла відповіді.
// Дії живлення (`shutdown`, `power_off`, `power_on`) існують лише всередині зміни розміру (AC-48); прибрати вузол —
// лише `DELETE` (AC-49).
import { SYSTEM_CLOCK } from '../../node.mjs';
import { assertNodeTags, ProviderError } from '../provider.mjs';
import { DO_API, DO_ENV, DO_IMAGE, DO_LOCAL_BASE, DO_TIMEOUTS, ENV_SIZES } from './config.mjs';

/**
 * @typedef {import('../provider.mjs').Node} Node
 * @typedef {import('../provider.mjs').Size} Size
 * @typedef {import('../provider.mjs').Provider} Provider
 * @typedef {import('../../node.mjs').Clock} Clock
 * @typedef {typeof DO_TIMEOUTS} Timeouts
 */

const RE_ID = /^\d{1,20}$/;
const RE_FINGERPRINT = /^(?:[0-9a-f]{2}:){15}[0-9a-f]{2}$/;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;

/**
 * Базова адреса: справжній API або `http://127.0.0.1:<port>` з `DO_API_BASE`.
 * @param {Record<string, string | undefined>} env
 */
export function resolveBase(env) {
  const custom = env[DO_ENV.base];
  if (!custom) return DO_API;
  if (!DO_LOCAL_BASE.test(custom)) throw new Error(`${DO_ENV.base} дозволено лише як http://127.0.0.1:<port>`);
  return custom;
}

/**
 * Секунди до повтору: `ratelimit-reset` (мітка часу Unix) або `retry-after` (секунди).
 * @param {Headers} headers
 * @param {number} nowMs
 * @returns {number | undefined}
 */
export function retryAfterOf(headers, nowMs) {
  const reset = Number(headers.get('ratelimit-reset'));
  if (headers.has('ratelimit-reset') && Number.isFinite(reset)) {
    return reset > 1e9 ? Math.max(0, Math.ceil(reset - nowMs / 1000)) : Math.max(0, Math.ceil(reset));
  }
  const after = Number(headers.get('retry-after'));
  if (headers.has('retry-after') && Number.isFinite(after)) return Math.max(0, Math.ceil(after));
  return undefined;
}

/**
 * @param {any} d об’єкт `droplet` з API
 * @returns {Node}
 */
export function toNode(d) {
  const v4 = Array.isArray(d?.networks?.v4) ? d.networks.v4 : [];
  const pub = v4.find((/** @type {any} */ n) => n?.type === 'public');
  const status = d?.status === 'active' || d?.status === 'new' ? d.status : 'off';
  return {
    id: String(d.id),
    name: String(d.name),
    size: String(d.size_slug ?? d.size?.slug ?? ''),
    status,
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    publicIp: typeof pub?.ip_address === 'string' ? pub.ip_address : null,
    diskGb: Number(d.disk ?? 0),
  };
}

/**
 * @param {{
 *   env: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   clock?: Clock,
 *   timeouts?: Partial<Timeouts>,
 * }} o
 * @returns {Provider}
 */
export function createDigitalOcean(o) {
  const base = resolveBase(o.env);
  const token = o.env[DO_ENV.token];
  if (!token) throw new Error(`${DO_ENV.token} не задано`);
  const doFetch = o.fetch ?? globalThis.fetch;
  const clock = o.clock ?? SYSTEM_CLOCK;
  const t = { ...DO_TIMEOUTS, ...o.timeouts };
  const baseHost = new URL(base).host;

  /**
   * @param {string} method
   * @param {string} path шлях від `/v2/`
   * @param {unknown} body
   * @param {string} step назва виклику для помилки
   * @returns {Promise<any>}
   */
  async function request(method, path, body, step) {
    /** @type {Response} */
    let res;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError({ status: 0, step });
    }
    if (!res.ok) {
      // Тіло відмови (`message`) не читається й не друкується разом із даними запиту.
      await res.body?.cancel().catch(() => {});
      throw new ProviderError({ status: res.status, retryAfterSec: retryAfterOf(res.headers, clock.now()), step });
    }
    const text = res.status === 204 ? '' : await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError({ status: res.status, step: `${step}: відповідь не JSON` });
    }
  }

  /**
   * Наступна сторінка: лише шлях `/v2/…` на тому самому API (повна адреса з відповіді не використовується).
   * @param {unknown} next
   */
  const nextPath = (next) => {
    if (typeof next !== 'string' || next === '') return null;
    const u = new URL(next);
    if (u.host !== new URL(DO_API).host && u.host !== baseHost) throw new Error('пагінація веде на чужу адресу');
    if (!u.pathname.startsWith('/v2/')) throw new Error('пагінація веде поза API');
    return `${u.pathname}${u.search}`;
  };

  /**
   * @param {string} first
   * @param {string} key
   * @param {string} step
   */
  async function listAll(first, key, step) {
    /** @type {any[]} */
    const items = [];
    /** @type {string | null} */
    let path = first;
    for (let page = 0; path && page < MAX_PAGES; page++) {
      const json = await request('GET', path, undefined, step);
      if (Array.isArray(json?.[key])) items.push(...json[key]);
      path = nextPath(json?.links?.pages?.next);
    }
    return items;
  }

  /** @param {string} id */
  const checkId = (id) => {
    if (!RE_ID.test(id)) throw new Error('недопустимий id вузла');
    return id;
  };

  /** @param {string} id @param {string} step @returns {Promise<Node>} */
  const getNode = async (id, step) => toNode((await request('GET', `/v2/droplets/${checkId(id)}`, undefined, step)).droplet);

  /** @param {string} id @param {Record<string, unknown>} body @param {string} step @returns {Promise<string>} */
  const action = async (id, body, step) => {
    const json = await request('POST', `/v2/droplets/${checkId(id)}/actions`, body, step);
    return String(json?.action?.id);
  };

  /**
   * @param {string} id @param {string} actionId @param {number} ms @param {string} step
   * @returns {Promise<'completed' | 'errored' | 'timeout'>}
   */
  const waitAction = async (id, actionId, ms, step) => {
    if (!RE_ID.test(actionId)) throw new Error(`${step}: недопустимий id дії`);
    const deadline = clock.now() + ms;
    for (;;) {
      const json = await request('GET', `/v2/droplets/${checkId(id)}/actions/${actionId}`, undefined, step);
      const s = json?.action?.status;
      if (s === 'completed' || s === 'errored') return s;
      if (clock.now() >= deadline) return 'timeout';
      await clock.sleep(t.pollMs);
    }
  };

  /** @param {string} id @param {Record<string, unknown>} body @param {string} step */
  const actionDone = async (id, body, step) => {
    const r = await waitAction(id, await action(id, body, step), t.actionMs, step);
    if (r !== 'completed') throw new Error(`${step}: дія ${r === 'errored' ? 'завершилась помилкою' : 'не завершилась вчасно'}`);
  };

  /** @type {Provider} */
  const provider = {
    async listNodes(tags) {
      if (!tags.length) throw new Error('listNodes: потрібен хоча б один тег');
      // Один тег на запит (API фільтрує лише за одним); решта — на клієнті.
      const q = new URLSearchParams({ tag_name: tags[0], per_page: '200' });
      const all = await listAll(`/v2/droplets?${q}`, 'droplets', 'listNodes');
      return all.map(toNode).filter((n) => tags.every((tag) => n.tags.includes(tag)));
    },

    async sizes() {
      const all = await listAll('/v2/sizes?per_page=200', 'sizes', 'sizes');
      return all.map((s) => ({
        slug: String(s.slug),
        vcpus: Number(s.vcpus),
        memoryMb: Number(s.memory),
        diskGb: Number(s.disk),
        priceHourly: Number(s.price_hourly),
      }));
    },

    async createNode(spec) {
      const key = String(o.env[DO_ENV.sshKey] ?? '').trim().toLowerCase();
      if (!RE_FINGERPRINT.test(key) && !RE_ID.test(key)) {
        throw new Error(`${DO_ENV.sshKey}: потрібен відбиток ключа SSH (aa:bb:…, 16 пар) або його числовий id`);
      }
      const json = await request(
        'POST',
        '/v2/droplets',
        {
          name: spec.name,
          region: spec.region,
          size: spec.size,
          image: DO_IMAGE,
          ssh_keys: [RE_ID.test(key) ? Number(key) : key],
          tags: spec.tags,
          ipv6: false,
          monitoring: false,
        },
        'createNode',
      );
      const id = String(json?.droplet?.id);
      return provider.waitNode(id, 'active');
    },

    async resizeNode(id, size, opts) {
      // Лише CPU/RAM (`disk: false`): збільшений диск не повернути назад, тож інше адаптер не робить (AC-48).
      if (opts?.keepDisk !== true) throw new Error('resizeNode: підтримується лише keepDisk: true (без зміни диска)');
      let node = await getNode(id, 'resizeNode');
      // Тегова межа тут, а не лише у викликача: без обох тегів вузол не вимикається й не змінюється.
      assertNodeTags(node, opts.requireTags, 'resizeNode');
      if (node.size !== size) {
        if (node.status !== 'off') {
          // М’яке вимкнення; якщо за 60 с не вимкнувся — `power_off`.
          const soft = await waitAction(id, await action(id, { type: 'shutdown' }, 'resizeNode:shutdown'), t.shutdownMs, 'resizeNode:shutdown');
          if (soft !== 'completed') await actionDone(id, { type: 'power_off' }, 'resizeNode:power_off');
          await provider.waitNode(id, 'off');
        }
        // Лише CPU/RAM: диск не збільшується, тож розмір можна повернути назад (AC-48).
        await actionDone(id, { type: 'resize', size, disk: false }, 'resizeNode:resize');
        node = await getNode(id, 'resizeNode');
      }
      if (node.status !== 'active') {
        await actionDone(id, { type: 'power_on' }, 'resizeNode:power_on');
        await provider.waitNode(id, 'active');
      }
      return { keepDisk: true };
    },

    async deleteNode(id, opts) {
      assertNodeTags(await getNode(id, 'deleteNode'), opts?.requireTags, 'deleteNode');
      await request('DELETE', `/v2/droplets/${checkId(id)}`, undefined, 'deleteNode');
    },

    async waitNode(id, state) {
      const deadline = clock.now() + t.nodeMs;
      for (;;) {
        const node = await getNode(id, 'waitNode');
        if (node.status === state) return node;
        if (clock.now() >= deadline) throw new Error(`waitNode: вузол ${node.name} не перейшов у стан ${state} вчасно`);
        await clock.sleep(t.pollMs);
      }
    },
  };
  return provider;
}

/**
 * Набір для команди `capacity`: провайдер і розміри середовищ.
 * @param {{ env: Record<string, string | undefined>, fetch?: typeof globalThis.fetch, clock?: Clock, timeouts?: Partial<Timeouts> }} o
 * @returns {import('../provider.mjs').ProviderBundle}
 */
export function createBundle(o) {
  return { name: 'digitalocean', provider: createDigitalOcean(o), envSizes: ENV_SIZES };
}
