// @ts-check
// Розбір аргументів підкоманд: перелік дозволеного (allow-list) і перевірка кожного значення до будь-якої дії (AC-10).
// Відмова — `{ code: 2, message }` з назвою прапорця; значення з керівними символами назад не виводиться.
import { isIPv4 } from 'node:net';
import { BOOTSTRAP_ENVS, ENVS } from './config.mjs';

const ALL_ENVS = Object.keys(ENVS);
const RE_COMMIT = /^[0-9a-f]{7,40}$/;
const RE_SHA40 = /^[0-9a-f]{40}$/;
const RE_SIZE = /^[a-z0-9-]{1,40}$/;
const RE_WORKER = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RE_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/**
 * Чи є в рядку керівні символи (U+0000–U+001F, U+007F): перевод рядка, NUL, табуляція тощо.
 * @param {string} v
 */
export function hasControl(v) {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Ім’я хоста за RFC 1123: мітки a-z0-9 і дефіс (не на краях), ≤63 символи, усього ≤253.
 * Жодна мітка не схожа на число — ні з самих цифр, ні шістнадцяткова `0x…`: інакше ім’я може бути іншим написанням
 * адреси (`0xb2149d55`, `178.20.157.0x55`) чи вести на вбудовану адресу (`178.20.157.85.nip.io`).
 * @param {string} v
 */
export function isHostName(v) {
  if (v.length < 1 || v.length > 253) return false;
  const labels = v.split('.');
  if (!labels.every((l) => RE_LABEL.test(l))) return false;
  return !labels.some((l) => /^[0-9]+$/.test(l) || /^0x[0-9a-f]*$/i.test(l));
}

/** @param {string} v */
const isTarget = (v) => v === 'local' || isIPv4(v) || isHostName(v);
/** @param {string} v */
const isHost = (v) => isIPv4(v) || isHostName(v);
/** @param {string} v */
const isLocalPath = (v) => v.length > 0 && v.length <= 4096 && !v.startsWith('-');

/**
 * @typedef {{
 *   check: (v: string) => boolean,
 *   expect: string,
 *   lower?: boolean,
 * }} Validator
 */

/** @type {Record<string, Validator>} */
const V = {
  commit: { check: (v) => RE_COMMIT.test(v), expect: '7–40 шістнадцяткових символів (нижній регістр)' },
  target: { check: isTarget, expect: '`local`, IPv4-адреса або ім’я хоста', lower: true },
  host: { check: isHost, expect: 'IPv4-адреса або ім’я хоста', lower: true },
  sha40: { check: (v) => RE_SHA40.test(v), expect: '40 шістнадцяткових символів (нижній регістр)' },
  worker: { check: (v) => RE_WORKER.test(v), expect: 'ім’я Worker’а (a-z, 0-9, дефіс)' },
  confirm: { check: (v) => ALL_ENVS.includes(v), expect: `одне з: ${ALL_ENVS.join(', ')}` },
  size: { check: (v) => RE_SIZE.test(v), expect: 'a-z, 0-9, дефіс, до 40 символів' },
  path: { check: isLocalPath, expect: 'шлях до файлу' },
  holder: { check: (v) => v === 'dns' || RE_WORKER.test(v), expect: '`dns` або ім’я Worker’а, що зараз тримає ім’я', lower: true },
};

/**
 * @typedef {{
 *   envs?: string[],
 *   values: Record<string, Validator>,
 *   bools: string[],
 *   required: string[],
 *   oneOf?: string[],
 *   positional?: string[],
 * }} SubSpec
 */

/** Дозволені прапорці кожної підкоманди. Усе, чого тут немає, — відмова. @type {Record<string, SubSpec>} */
export const SUBCOMMAND_SPECS = {
  deploy: {
    envs: ALL_ENVS,
    // `--take-domain-from` — лише для робочого домену: хто зараз тримає ім’я (Worker чи `dns`), F1.
    values: { '--target': V.target, '--commit': V.commit, '--confirm': V.confirm, '--secrets-file': V.path, '--take-domain-from': V.holder },
    bools: ['--allow-main-domain', '--emergency', '--probe'],
    required: ['--env'],
  },
  rollback: {
    envs: ALL_ENVS,
    values: { '--target': V.target, '--to': V.sha40, '--confirm': V.confirm, '--secrets-file': V.path },
    bools: ['--allow-main-domain', '--emergency', '--probe'],
    required: ['--env'],
  },
  bootstrap: {
    envs: BOOTSTRAP_ENVS,
    values: { '--host': V.host, '--secrets-file': V.path },
    bools: [],
    required: ['--host'],
  },
  'edge-secret': {
    envs: ['rehearsal'],
    values: { '--target': V.target, '--secrets-file': V.path },
    bools: ['--generate', '--rotate', '--probe'],
    required: ['--env'],
    oneOf: ['--generate', '--rotate'],
  },
  'move-domain': {
    values: { '--name': V.host, '--to': V.worker, '--confirm': V.confirm, '--secrets-file': V.path },
    // `--emergency` — лише для заморозки робочого домену в новорічну ніч (AC-23).
    bools: ['--allow-main-domain', '--emergency'],
    required: ['--name', '--to'],
  },
  capacity: {
    envs: ['rehearsal', 'production'],
    values: { '--size': V.size, '--confirm': V.confirm, '--secrets-file': V.path },
    // production — середовище робочого домену: запобіжник вимагає і `--confirm production`, і `--allow-main-domain`.
    // `--emergency` — зміна потужності production у вікні заморозки (AC-23); `plan`/`status` заморозка не чіпає.
    bools: ['--allow-main-domain', '--emergency', '--probe'],
    required: ['--env'],
    positional: ['plan', 'night', 'back', 'off-season', 'realtime-create', 'realtime-delete', 'status'],
  },
};

/**
 * Значення для повідомлення: лише друковані ASCII до 64 символів, інакше не виводиться.
 * @param {string} v
 */
function shown(v) {
  return /^[\x20-\x7e]{1,64}$/.test(v) ? ` (${JSON.stringify(v)})` : '';
}

/**
 * @typedef {{
 *   sub: string,
 *   env?: string,
 *   action?: string,
 *   values: Record<string, string>,
 *   flags: Record<string, boolean>,
 * }} ParsedArgs `values` і `flags` — за назвою прапорця без `--` (`target`, `allow-main-domain`).
 */

/**
 * Розбирає і перевіряє аргументи підкоманди. Нічого не виконує.
 * @param {string} sub
 * @param {string[]} argv аргументи після назви підкоманди
 * @returns {{ ok: true, args: ParsedArgs } | { ok: false, code: 2, message: string }}
 */
export function parseArgs(sub, argv) {
  /** @param {string} message @returns {{ ok: false, code: 2, message: string }} */
  const fail = (message) => ({ ok: false, code: 2, message });
  const spec = Object.hasOwn(SUBCOMMAND_SPECS, sub) ? SUBCOMMAND_SPECS[sub] : undefined;
  if (!spec) return fail(`невідома підкоманда${shown(sub)}`);

  /** @type {ParsedArgs} */
  const args = { sub, values: {}, flags: {} };
  /** @type {Set<string>} */
  const seen = new Set();
  const rest = argv.map(String);
  // `pnpm <script> -- …` може передати роздільник: один на початку пропускаємо.
  if (rest[0] === '--') rest.shift();

  while (rest.length) {
    const a = /** @type {string} */ (rest.shift());
    if (hasControl(a)) return fail('аргумент містить керівні символи');
    if (!a.startsWith('--')) {
      if (spec.positional && args.action === undefined) {
        if (!spec.positional.includes(a)) return fail(`невідома дія${shown(a)}: одна з ${spec.positional.join(', ')}`);
        args.action = a;
        continue;
      }
      return fail(`зайвий аргумент${shown(a)}`);
    }
    if (seen.has(a)) return fail(`${a}: прапорець повторено`);
    seen.add(a);

    if (a === '--env' && spec.envs) {
      const v = rest.shift();
      if (v === undefined) return fail('--env: немає значення');
      if (hasControl(v)) return fail('--env: значення містить керівні символи');
      if (!spec.envs.includes(v)) return fail(`--env: невідоме середовище${shown(v)}; для ${sub} дозволено: ${spec.envs.join(', ')}`);
      args.env = v;
    } else if (Object.hasOwn(spec.values, a)) {
      const v = rest.shift();
      if (v === undefined) return fail(`${a}: немає значення`);
      if (hasControl(v)) return fail(`${a}: значення містить керівні символи`);
      const val = spec.values[a];
      const norm = val.lower ? v.toLowerCase() : v;
      if (!val.check(norm)) return fail(`${a}: недопустиме значення${shown(v)}; очікується ${val.expect}`);
      args.values[a.slice(2)] = norm;
    } else if (spec.bools.includes(a)) {
      args.flags[a.slice(2)] = true;
    } else {
      return fail(`невідомий прапорець${shown(a)} для ${sub}`);
    }
  }

  for (const r of spec.required) {
    if (!seen.has(r)) return fail(`${r}: обов’язковий для ${sub}`);
  }
  if (spec.oneOf && spec.oneOf.filter((f) => seen.has(f)).length !== 1) {
    return fail(`потрібен рівно один із прапорців: ${spec.oneOf.join(', ')}`);
  }
  if (spec.positional && args.action === undefined) return fail(`потрібна дія: одна з ${spec.positional.join(', ')}`);
  return { ok: true, args };
}
