// @ts-check
// Журнал спайку: JSON Lines у `infra/ops/.local/spike/journal.jsonl`, рядок на кожну змінну дію. Значення — лише рядки,
// числа, булеві й масиви рядків; рядок, що містить зареєстрований секрет, не пишеться (відмова).
import fs from 'node:fs';
import path from 'node:path';

export const JOURNAL = 'journal.jsonl';

/**
 * @typedef {{ contains: (text: string) => boolean }} SecretCheck
 * @typedef {Record<string, string | number | boolean | null | string[]>} Fields
 */

/**
 * @param {string} dir
 * @param {SecretCheck} redactor
 * @param {Date} at
 * @param {string} cmd
 * @param {string} step
 * @param {'ok' | 'failed' | 'skipped' | 'refused'} result
 * @param {Fields} [fields]
 */
export function journal(dir, redactor, at, cmd, step, result, fields = {}) {
  /** @type {Record<string, unknown>} */
  const rec = { at: at.toISOString(), cmd, step, result };
  for (const [k, v] of Object.entries(fields)) {
    const ok =
      v === null ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v)) ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) || !ok) throw new Error(`журнал спайку: недопустиме поле ${k}`);
    rec[k] = v;
  }
  const line = JSON.stringify(rec);
  if (redactor.contains(line)) throw new Error('журнал спайку: запис містить значення секрету — не записано');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, JOURNAL), `${line}\n`, { mode: 0o600 });
}

/**
 * Усі записи журналу (биті рядки пропускаються).
 * @param {string} dir
 * @returns {Record<string, any>[]}
 */
export function readJournal(dir) {
  /** @type {string} */
  let text;
  try {
    text = fs.readFileSync(path.join(dir, JOURNAL), 'utf8');
  } catch {
    return [];
  }
  /** @type {Record<string, any>[]} */
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* битий рядок */
    }
  }
  return out;
}
