// @ts-check
// Токен тунелю для локального cloudflared: лише у файлі поза git (`.local/`, у .gitignore), режим 0600.
// Значення токена ніколи не друкується й не потрапляє в текст помилки.
import fs from 'node:fs';
import path from 'node:path';

/** Токен тунелю — base64-подібний рядок; інше (перенос рядка, пробіл) зламало б env-файл. */
const TOKEN_SHAPE = /^[A-Za-z0-9+/=_.-]{1,4096}$/;

/**
 * @param {string} localDir тека `.local`
 * @param {string} envName
 */
export function tokenFilePath(localDir, envName) {
  if (!/^[a-z0-9-]+$/.test(envName)) throw new Error('недопустима назва середовища для файлу токена');
  return path.join(localDir, `tunnel-${envName}.env`);
}

/**
 * @param {string} localDir
 * @param {string} envName
 */
export function tokenFileExists(localDir, envName) {
  return fs.existsSync(tokenFilePath(localDir, envName));
}

/**
 * Пише `TUNNEL_TOKEN=<token>\n` з режимом 0600. Не перезаписує наявний файл (`wx`).
 * @param {string} localDir
 * @param {string} envName
 * @param {unknown} token
 * @returns {string} шлях до файлу
 */
export function writeTokenFile(localDir, envName, token) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) {
    throw new Error('Cloudflare повернув токен тунелю неочікуваного вигляду; файл не записано');
  }
  const file = tokenFilePath(localDir, envName);
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, `TUNNEL_TOKEN=${token}\n`, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    throw new Error(`не вдалося записати файл токена ${file} (${code ?? 'помилка'})`);
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows не має POSIX-режимів; файл лежить у теці користувача поза git.
  }
  return file;
}

/**
 * Позначка «застосунок Access для адмінки середовища створено цим скриптом» (F2): без значень, лише дата.
 * Поки вона є й Access це підтверджує (N3: застосунок з цим `domain` і політикою є), `plan`/`apply` без
 * `--with-access` лишають ім'я адмінки в бажаному стані (інакше — прибирають).
 * @param {string} localDir
 * @param {string} envName
 */
export function accessMarkerPath(localDir, envName) {
  if (!/^[a-z0-9-]+$/.test(envName)) throw new Error('недопустима назва середовища для позначки Access');
  return path.join(localDir, `access-${envName}.ok`);
}

/** @param {string} localDir @param {string} envName */
export function accessMarkerExists(localDir, envName) {
  return fs.existsSync(accessMarkerPath(localDir, envName));
}

/**
 * Прибирає позначку, яку перевірка (N3) визнала застарілою: застосунку Access для адмінки немає чи він без політик.
 * @param {string} localDir @param {string} envName
 * @returns {boolean} чи був файл
 */
export function removeAccessMarker(localDir, envName) {
  const file = accessMarkerPath(localDir, envName);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/**
 * Пише позначку після успішного кроку Access (застосунок створено, оновлено чи вже був таким).
 * @param {string} localDir
 * @param {string} envName
 * @param {Date} at
 * @returns {string} шлях до файлу
 */
export function writeAccessMarker(localDir, envName, at) {
  const file = accessMarkerPath(localDir, envName);
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `access-app ok ${at.toISOString()}\n`, { mode: 0o600 });
  return file;
}
