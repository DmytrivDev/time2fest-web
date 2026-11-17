// @ts-check
// Звірка цілі SSH зі старою продакшн-адресою за тим, куди ціль справді веде (AC-22), а не лише за написанням:
// ім’я з DNS (зокрема `*.nip.io`), псевдонім з `~/.ssh/config` (`ssh -G`), IPv4 усередині IPv6 (`::ffff:a.b.c.d`,
// NAT64 `64:ff9b::/96`, 6to4 `2002::/16`). Перевірка йде до першого виклику SSH; резолвер DNS і `ssh -G` — порти
// (`ctx.deps`), у тестах підставні. Перевірена IPv4-адреса повертається: перший вхід (`bootstrap`, вузол realtime)
// з’єднується саме з нею, а не резолвить ім’я вдруге (TOCTOU).
import { isIP, isIPv4, isIPv6 } from 'node:net';
import { FORBIDDEN_TARGETS } from './config.mjs';

/**
 * @typedef {{
 *   lookupHost: (host: string) => Promise<string[]>,
 *   sshHostname: (host: string) => Promise<string>,
 * }} TargetPorts `lookupHost` — усі адреси імені (`dns.lookup(host, { all: true })`); `sshHostname` — рядок
 *   `hostname` з `ssh -G <host>` (куди ssh з налаштуваннями користувача справді з’єднався б).
 */

/**
 * 8 груп IPv6 по 16 біт; `null` — не IPv6.
 * @param {string} a
 * @returns {number[] | null}
 */
function ipv6Groups(a) {
  let s = a.toLowerCase().replace(/%.*$/, '');
  if (!isIPv6(s)) return null;
  // Хвіст у вигляді IPv4 → дві групи.
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const o = m[2].split('.').map(Number);
    s = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, undefined];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0');
  const groups = [...h, ...fill, ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** @param {number} hi @param {number} lo 32 біти з двох груп IPv6 → крапковий IPv4. */
const v4 = (hi, lo) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

/**
 * Адреса в канонічному вигляді: IPv4 — крапковий десятковий; IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible
 * (`::a.b.c.d`), NAT64 (`64:ff9b::a.b.c.d`, RFC 6052) і 6to4 (`2002:AABB:CCDD::…`, RFC 3056) IPv6 — їхній IPv4;
 * інший IPv6 — 8 груп hex без скорочень. Не адреса — `null`.
 * @param {string} addr
 * @returns {string | null}
 */
export function normalizeAddress(addr) {
  const a = String(addr).trim().toLowerCase();
  if (isIPv4(a)) return a;
  const g = ipv6Groups(a);
  if (!g) return null;
  const zero5 = g.slice(0, 5).every((x) => x === 0);
  if (zero5 && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)))) return v4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4(g[6], g[7]);
  if (g[0] === 0x2002) return v4(g[1], g[2]);
  return g.map((x) => x.toString(16)).join(':');
}

const FORBIDDEN = new Set(FORBIDDEN_TARGETS.map((t) => normalizeAddress(t) ?? t));

/** Чи веде адреса на заборонену ціль. @param {string} addr */
export function isForbiddenAddress(addr) {
  const n = normalizeAddress(addr);
  return n !== null && FORBIDDEN.has(n);
}

/**
 * Куди веде ціль: `ssh -G` (псевдонім → справжнє ім’я), далі DNS для обох імен. Будь-яка адреса старого сервера —
 * відмова; ім’я, що не резолвиться, чи збій `ssh -G` — теж відмова (перевірку не пропускаємо).
 * `address` — перевірена IPv4-адреса цілі (сама ціль або перша IPv4 з відповіді DNS для неї; `null`, якщо IPv4 немає):
 * з нею з’єднується перший вхід, щоб друге розв’язання імені не вело кудись інде.
 * @param {string} host уже перевірене `args.mjs` (IPv4 або ім’я хоста)
 * @param {TargetPorts} ports
 * @returns {Promise<{ ok: true, address: string | null } | { ok: false, code: 2, message: string }>}
 */
export async function checkTarget(host, ports) {
  /** @param {string} message @returns {{ ok: false, code: 2, message: string }} */
  const refuse = (message) => ({ ok: false, code: 2, message });
  const h = String(host).trim().toLowerCase().replace(/\.$/, '');
  if (isForbiddenAddress(h)) return refuse(`заборонена ціль ${h}: старий продакшн-сервер; жоден прапорець не дозволяє`);

  /** @type {string} */
  let effective;
  try {
    effective = String(await ports.sshHostname(h)).trim().toLowerCase().replace(/\.$/, '');
  } catch {
    return refuse(`${h}: не вдалося визначити ціль через ssh -G — перевірку цілі не пропускаю`);
  }
  if (!effective) return refuse(`${h}: ssh -G не назвав hostname — перевірку цілі не пропускаю`);
  if (isForbiddenAddress(effective)) return refuse(`${h}: налаштування ssh ведуть на заборонену ціль (старий продакшн-сервер)`);

  /** @type {string | null} */
  let address = isIPv4(h) ? h : null;
  for (const name of new Set([h, effective])) {
    if (isIP(name)) continue;
    /** @type {string[]} */
    let addrs;
    try {
      addrs = await ports.lookupHost(name);
    } catch {
      return refuse(`${name}: ім’я не резолвиться — перевірку цілі не пропускаю`);
    }
    if (!Array.isArray(addrs) || addrs.length === 0) return refuse(`${name}: ім’я не резолвиться — перевірку цілі не пропускаю`);
    if (addrs.some((a) => isForbiddenAddress(a))) return refuse(`${name} веде на заборонену ціль (старий продакшн-сервер); жоден прапорець не дозволяє`);
    if (name === h) address = addrs.map((a) => String(a).trim()).find((a) => isIPv4(a)) ?? null;
  }
  return { ok: true, address };
}
