// @ts-check
import { SECRET_ENV_NAMES } from './config.mjs';

/**
 * Маскує значення секретів у кожному рядку виводу.
 * @param {Record<string, string | undefined>} env
 */
export function createRedactor(env) {
  /** @type {Set<string>} */
  const secrets = new Set();
  for (const n of SECRET_ENV_NAMES) {
    const v = env[n];
    if (v) secrets.add(v);
  }
  return {
    /** @param {string | undefined} value */
    add(value) {
      if (value) secrets.add(value);
    },
    /** @param {string} line */
    mask(line) {
      let out = String(line);
      for (const s of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
      return out;
    },
  };
}
