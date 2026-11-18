// @ts-check
/**
 * Listen address of the server (SPEC-13a AC-2). Pure: reads only the object it is given, never
 * `process.env`. Class `test` stays on loopback (SPEC-02 AC-61) whatever `T2F_HOST` says; every
 * other class needs both `T2F_HOST` and `T2F_SERVER_PORT`. A failure names variables only.
 */

/**
 * Same rule as `T2F_HOST` in `src/registries/env.ts` (an IPv4 address or a host name; every IPv4
 * address also matches the host-name pattern, so the pattern alone is the whole rule).
 */
const HOST_NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

/**
 * @param {unknown} value
 * @returns {number | undefined} the port when `value` is a decimal integer in 1–65535
 */
function portOf(value) {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= 65535 ? n : undefined;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidHost(value) {
  return typeof value === 'string' && HOST_NAME.test(value);
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ host: string, port: number } | { failing: string[] }}
 */
export function listenAddress(env) {
  const port = portOf(env.T2F_SERVER_PORT);
  if (env.T2F_ENV === 'test') {
    return port === undefined ? { failing: ['T2F_SERVER_PORT'] } : { host: '127.0.0.1', port };
  }
  /** @type {string[]} */
  const failing = [];
  if (!isValidHost(env.T2F_HOST)) failing.push('T2F_HOST');
  if (port === undefined) failing.push('T2F_SERVER_PORT');
  if (failing.length > 0 || port === undefined) return { failing };
  return { host: String(env.T2F_HOST), port };
}
