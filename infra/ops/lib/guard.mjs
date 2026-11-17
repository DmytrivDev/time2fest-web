// @ts-check
// Запобіжник запуску: стара продакшн-адреса (AC-22), робочий домен (AC-21), заморозка production (AC-23).
// Спрацьовує після розбору аргументів і до будь-якого виклику ssh, docker чи wrangler. Відмова — код 2.
import { ENVS, FORBIDDEN_TARGETS, FREEZE_WINDOW, MAIN_HOSTS } from './config.mjs';

/** Підкоманди, на які діє заморозка production (середовище з `freeze`). */
const FREEZE_SUBS = new Set(['deploy', 'rollback', 'capacity']);
/** Дії `capacity`, що лише читають стан: заморозка на них не діє. */
const READ_ONLY_ACTIONS = new Set(['plan', 'status']);

/** @param {string} h */
const norm = (h) => String(h).trim().toLowerCase().replace(/\.$/, '');
const FORBIDDEN = new Set(FORBIDDEN_TARGETS.map(norm));
const MAIN = new Set(MAIN_HOSTS.map(norm));

/**
 * Чи `now` у вікні заморозки `[31.12 08:00Z, 01.01 14:00Z)`.
 * @param {Date} now
 */
export function inFreezeWindow(now) {
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  const { start, end } = FREEZE_WINDOW;
  if (m === start.month && d === start.day && h >= start.hour) return true;
  return m === end.month && d === end.day && h < end.hour;
}

/**
 * @param {{
 *   sub: string,
 *   env?: string,
 *   action?: string,
 *   target?: string,
 *   hosts?: string[],
 *   flags: { confirm?: string, allowMainDomain?: boolean, emergency?: boolean },
 *   now: Date,
 * }} input `target` — вузол (`--target`/`--host`); `hosts` — інші імена, яких торкається команда (`--name`);
 *   `action` — дія `capacity` (`plan`, `status` — лише читання).
 * @returns {{ ok: true } | { ok: false, code: 2, message: string }}
 */
export function guardRun({ sub, env, action, target, hosts = [], flags, now }) {
  /** @param {string} message @returns {{ ok: false, code: 2, message: string }} */
  const refuse = (message) => ({ ok: false, code: 2, message });
  const touched = [target, ...hosts].filter((h) => typeof h === 'string' && h !== '').map((h) => norm(/** @type {string} */ (h)));

  // AC-22: жоден прапорець не дозволяє.
  const forbidden = touched.find((h) => FORBIDDEN.has(h));
  if (forbidden) return refuse(`заборонена ціль ${forbidden}: старий продакшн-сервер; жоден прапорець не дозволяє`);

  if (env !== undefined && !Object.hasOwn(ENVS, env)) return refuse('невідоме середовище');
  const cfg = env !== undefined ? ENVS[env] : undefined;

  // AC-21: робочий домен — лише з `--confirm <env>` і `--allow-main-domain` разом.
  const mainHosts = touched.filter((h) => MAIN.has(h));
  if (cfg?.mainDomain || mainHosts.length) {
    const what = cfg?.mainDomain ? `середовище ${env}` : `робочий домен ${mainHosts.join(', ')}`;
    // Без `--env` (move-domain) підтвердження має назвати середовище робочого домену.
    const confirmOk =
      env !== undefined
        ? flags.confirm === env
        : flags.confirm !== undefined && Object.hasOwn(ENVS, flags.confirm) && ENVS[flags.confirm].mainDomain === true;
    if (!confirmOk || !flags.allowMainDomain) {
      const need = env !== undefined ? `--confirm ${env}` : '--confirm <prelaunch|production>';
      return refuse(`${what} зачіпає робочий домен: потрібні разом ${need} і --allow-main-domain`);
    }
  }

  // AC-23: заморозка production у новорічну ніч. Діє на розгортання, відкат, зміну потужності production (крім
  // `plan`/`status`) і перенесення імені робочого домену (`move-domain` без `--env`).
  const frozenEnv = cfg?.freeze === true && FREEZE_SUBS.has(sub) && !(sub === 'capacity' && READ_ONLY_ACTIONS.has(String(action)));
  const frozenMove = sub === 'move-domain' && mainHosts.length > 0;
  if ((frozenEnv || frozenMove) && inFreezeWindow(now) && !flags.emergency) {
    const what = frozenEnv ? `заморозка ${env}` : `заморозка робочого домену ${mainHosts.join(', ')}`;
    return refuse(`${what}: 31.12 08:00 – 01.01 14:00 UTC; ${sub} лише з --emergency`);
  }
  return { ok: true };
}
