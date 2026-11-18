// @ts-check
// Файли змінних вузла на диску: локальні оригінали в `.local/<env>/` (0600, git-ignored на Windows) і надсилання
// на ціль (вузол — stdin у `sh -c`, локальна ціль — копія 0600). Значення ніколи не йдуть в argv чи вивід.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.mjs';

/** Файли змінних вузла (W11): поруч із `compose.yml` на вузлі, оригінали — у `.local/<env>/`. */
export const NODE_ENV_FILES = /** @type {const} */ (['server.env', 'postgres.env', 'redis.env', 'cloudflared.env']);
/** Віддалений запис файлу змінних: права 0600 від початку, атомарна заміна. Шлях — `$1`, вміст — stdin. */
export const PUSH_SCRIPT = 'umask 077 && cat > "$1.tmp" && mv "$1.tmp" "$1"';
/** Позначка «новий секрет краю ще не в Worker’і» (без значення): повторний запуск дошле його. */
export const WORKER_PENDING = 'edge-secret.worker-pending';
const PUSH_TIMEOUT_MS = 30_000;

/**
 * @typedef {import('../exec.mjs').Transport} Transport
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 * @typedef {'server.env' | 'postgres.env' | 'redis.env' | 'cloudflared.env'} EnvFileName
 */

/** Каталог локальних оригіналів середовища. @param {OpsContext} ctx @param {string} env */
export function localEnvDir(ctx, env) {
  return path.join(ctx.paths.stateRoot, env);
}

/**
 * Файл лише для власника. Windows: права не діють — замість них шлях має бути git-ignored (`git check-ignore -q`).
 * Відмова — виняток із `code: 2` до запису.
 * @param {OpsContext} ctx
 * @param {string} file
 */
export async function assertPrivatePath(ctx, file) {
  if (ctx.platform !== 'win32') return;
  const r = await ctx.exec.run('git', ['check-ignore', '-q', file], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (r.code !== 0) throw Object.assign(new Error(`${path.basename(file)}: шлях не git-ignored — секрети туди не пишуться`), { code: 2 });
}

/**
 * Атомарний локальний запис з режимом 0600.
 * @param {string} file
 * @param {string} text
 */
export function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/**
 * Надсилає файл змінних на ціль: вузол — `sh -c PUSH_SCRIPT` зі вмістом на stdin; локальна ціль — копія 0600.
 * @param {Transport} transport
 * @param {string} nodeDir
 * @param {string} name
 * @param {string} text
 */
export async function pushFile(transport, nodeDir, name, text) {
  if (transport.kind === 'local') {
    writePrivate(path.join(nodeDir, name), text);
    return;
  }
  const argv = ['sh', '-c', PUSH_SCRIPT, '_', path.posix.join(nodeDir, name)];
  const r = await transport.exec(argv, { input: text, allow: [...argv], timeoutMs: PUSH_TIMEOUT_MS });
  if (r.code !== 0) throw new Error(`надсилання ${name} завершилося з кодом ${r.code}`);
}
