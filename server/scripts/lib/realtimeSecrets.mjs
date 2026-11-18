// @ts-check
/**
 * Shared Centrifugo secrets of the local stack (SPEC-06 W10, AC-60). One file for all worktrees,
 * `<main checkout>/.claude/sdd/realtime/centrifugo.env` (gitignored through `.claude/sdd/`).
 * Values are never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveLockDir } from './lock.mjs';

const TOKEN_KEY = 'T2F_CENTRIFUGO_TOKEN_SECRET';
const API_KEY = 'T2F_CENTRIFUGO_API_KEY';

/**
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function realtimeSecretsFile(cwd, env) {
  return path.join(path.dirname(resolveLockDir(cwd, env)), 'realtime', 'centrifugo.env');
}

/** @param {string} text @param {string} name */
function read(text, name) {
  const m = new RegExp(`^${name}=(.+)$`, 'm').exec(text);
  return m?.[1]?.trim() ?? '';
}

/**
 * Creates the file (mode 0600) with two different random 256-bit hex values when absent or incomplete;
 * otherwise returns the stored values.
 * @param {string} file
 * @returns {{ T2F_CENTRIFUGO_TOKEN_SECRET: string, T2F_CENTRIFUGO_API_KEY: string }}
 */
export function ensureRealtimeSecrets(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const tokenSecret = read(text, TOKEN_KEY) || crypto.randomBytes(32).toString('hex');
  const apiKey = read(text, API_KEY) || crypto.randomBytes(32).toString('hex');
  if (text === '' || read(text, TOKEN_KEY) === '' || read(text, API_KEY) === '') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${TOKEN_KEY}=${tokenSecret}\n${API_KEY}=${apiKey}\n`, { mode: 0o600 });
  }
  return { T2F_CENTRIFUGO_TOKEN_SECRET: tokenSecret, T2F_CENTRIFUGO_API_KEY: apiKey };
}
