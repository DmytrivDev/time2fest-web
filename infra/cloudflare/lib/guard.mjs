// @ts-check
// Запобіжник: зміни, що зачіпають робочий домен, усю зону або щось видаляють, проходять лише з явним прапорцем.
// Усе невідоме — заборонено (deny by default). Поштові DNS-записи (MX/TXT) не проходять ні з яким прапорцем.
import { MAIN_HOSTS } from './config.mjs';
import { ZONE_WIDE } from './diff.mjs';

/** @typedef {import('./diff.mjs').Change} Change */
/** @typedef {{ allowMainDomain?: boolean, allowZoneSettings?: boolean, allowDelete?: boolean }} GuardFlags */
/** @typedef {{ change: Change, reason: string, flag: string | null }} Refusal */

const KINDS = new Set(['tunnel', 'tunnel-config', 'dns', 'rule', 'zone-setting']);
const OPS = new Set(['create', 'update', 'delete']);
/** Типи DNS, які скрипт не змінює ніколи (пошта). */
const NEVER_DNS_TYPES = new Set(['MX', 'TXT', 'SPF']);
/** Єдиний тип DNS, з яким скрипт працює. */
const DNS_TYPES = new Set(['CNAME']);

/** @param {string} h */
const norm = (h) => String(h).trim().toLowerCase().replace(/\.$/, '');
const MAIN = new Set(MAIN_HOSTS.map(norm));

/**
 * @param {Change[]} changes
 * @param {GuardFlags} [flags]
 * @returns {{ ok: boolean, refused: Refusal[] }}
 */
export function guard(changes, flags = {}) {
  /** @type {Refusal[]} */
  const refused = [];
  for (const change of changes) {
    /** @param {string} reason @param {string | null} flag */
    const refuse = (reason, flag) => refused.push({ change, reason, flag });

    if (!KINDS.has(change.kind)) {
      refuse(`невідомий вид зміни «${change.kind}»`, null);
      continue;
    }
    if (!OPS.has(change.op)) {
      refuse(`невідома операція «${change.op}»`, null);
      continue;
    }
    if (change.kind === 'dns') {
      const type = String(change.data?.type ?? '').toUpperCase();
      if (NEVER_DNS_TYPES.has(type)) {
        refuse(`поштовий DNS-запис (${type}) скрипт не змінює ніколи`, null);
        continue;
      }
      if (!DNS_TYPES.has(type)) {
        refuse(`DNS-запис типу «${type || '?'}» скрипт не змінює`, null);
        continue;
      }
    }

    const hosts = Array.isArray(change.hosts) && change.hosts.length ? change.hosts.map(norm) : [ZONE_WIDE];
    const main = hosts.filter((h) => MAIN.has(h));
    if (main.length && !flags.allowMainDomain) refuse(`зачіпає робочий домен: ${main.join(', ')}`, '--allow-main-domain');
    if ((hosts.includes(ZONE_WIDE) || change.kind === 'zone-setting') && !flags.allowZoneSettings) {
      refuse('діє на всю зону', '--allow-zone-settings');
    }
    if (change.op === 'delete' && !flags.allowDelete) refuse('видаляє ресурс або правило', '--allow-delete');
  }
  return { ok: refused.length === 0, refused };
}

/**
 * Рядки вердикту для виводу: по рядку на відмову.
 * @param {Refusal[]} refused
 * @returns {string[]}
 */
export function describeRefusals(refused) {
  return refused.map(
    (r) =>
      `заборонено: ${r.change.op} ${r.change.kind} ${r.change.target} — ${r.reason}; ${r.flag ? `потрібен прапорець ${r.flag}` : 'жоден прапорець не дозволяє'}`,
  );
}
