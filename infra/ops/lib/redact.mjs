// @ts-check
// Маскування секретів (NFR-4): кожен рядок stdout, stderr і журналу проходить через `mask`.
import { SECRET_ENV_NAMES } from './config.mjs';

/** Коротші значення не маскуються: надто легко зачепити звичайний текст. */
export const MIN_SECRET_LENGTH = 8;
export const MASK = '***';

/**
 * Значення та його закодовані форми, у яких воно може з’явитися у виводі.
 * @param {string} v
 * @returns {string[]}
 */
function formsOf(v) {
  const buf = Buffer.from(v, 'utf8');
  const b64 = buf.toString('base64');
  const hex = buf.toString('hex');
  return [v, b64, b64.replace(/=+$/, ''), buf.toString('base64url'), hex, hex.toUpperCase()];
}

/**
 * @param {Iterable<string | undefined | null>} [values]
 */
export function createRedactor(values = []) {
  /** @type {Set<string>} */
  const forms = new Set();
  /** @type {string[]} */
  let ordered = [];

  /** @param {string | undefined | null} value */
  function add(value) {
    if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return;
    for (const f of formsOf(value)) if (f.length >= MIN_SECRET_LENGTH) forms.add(f);
    // Довші — першими, щоб форма-префікс не лишила хвіст.
    ordered = [...forms].sort((a, b) => b.length - a.length);
  }
  for (const v of values) add(v);

  return {
    add,
    /** @param {string} line */
    mask(line) {
      let out = String(line);
      for (const f of ordered) if (out.includes(f)) out = out.split(f).join(MASK);
      return out;
    },
    /** Чи містить рядок зареєстроване значення (до маскування). @param {string} text */
    contains(text) {
      const s = String(text);
      return ordered.some((f) => s.includes(f));
    },
  };
}

/** @typedef {ReturnType<typeof createRedactor>} Redactor */

/**
 * Редактор зі значень секретних змінних середовища.
 * @param {Record<string, string | undefined>} env
 */
export function redactorFromEnv(env) {
  return createRedactor(SECRET_ENV_NAMES.map((n) => env[n]));
}

/**
 * Єдиний вихід ops: `out`/`err` маскують кожен рядок перед записом.
 * @param {Redactor} redactor
 * @param {(line: string) => void} rawOut
 * @param {(line: string) => void} rawErr
 */
export function createOutput(redactor, rawOut, rawErr) {
  return {
    /** @param {string} line */
    out: (line) => rawOut(redactor.mask(line)),
    /** @param {string} line */
    err: (line) => rawErr(redactor.mask(line)),
  };
}
