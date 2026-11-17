// @ts-check
// Текст файлів змінних (`NAME=value` по рядку): читання, заміна, видалення змінної; новий секрет; `DATABASE_URI`.
// Чисті функції без вводу-виводу — їх ділять `generate.mjs` і `rotate.mjs`.
import crypto from 'node:crypto';

export const SECRET_BYTES = 32;

/** Новий секрет: 32 байти CSPRNG у base64url (43 символи). */
export function newSecret() {
  return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

/** @param {string} name */
const lineRe = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`);

/**
 * Значення змінної з тексту env-файлу; немає рядка — `undefined`, порожнє — `''`. Лапки навколо знімаються.
 * @param {string} text
 * @param {string} name
 */
export function getVar(text, name) {
  const re = lineRe(name);
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const v = m[1].trim();
    return /^(["']).*\1$/.test(v) && v.length >= 2 ? v.slice(1, -1) : v;
  }
  return undefined;
}

/**
 * Ставить `NAME=value` замість першого рядка змінної або дописує в кінець.
 * @param {string} text
 * @param {string} name
 * @param {string} value
 */
export function setVar(text, name, value) {
  if (/[\r\n]/.test(value)) throw new TypeError(`${name}: значення з переводом рядка`);
  const re = lineRe(name);
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Прибирає всі рядки змінної.
 * @param {string} text
 * @param {string} name
 */
export function removeVar(text, name) {
  const re = lineRe(name);
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const kept = lines.filter((l) => !re.test(l));
  return kept.length ? `${kept.join('\n')}\n` : '';
}

/**
 * `DATABASE_URI` для контейнера сервера: збирається через `URL`, без рядкового літерала з паролем.
 * @param {{ user: string, password: string, db: string }} o
 */
export function databaseUri(o) {
  const u = new URL('postgres://postgres:5432/t2f_rehearsal');
  u.pathname = `/${o.db}`;
  u.username = o.user;
  u.password = o.password;
  return u.toString();
}
