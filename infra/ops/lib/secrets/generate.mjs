// @ts-check
// `ops edge-secret --generate` (AC-37, NFR-4): заповнює порожні значення файлів змінних вузла в `.local/<env>/`
// (значення — лише `randomBytes(32)`), за `--target` надсилає їх на ціль, новий секрет краю — у Worker через stdin.
import fs from 'node:fs';
import path from 'node:path';
import { resolveSite } from '../common.mjs';
import { acquireNodeLock } from '../lock.mjs';
import { databaseUri, getVar, newSecret, setVar } from './envFile.mjs';
import { assertPrivatePath, localEnvDir, NODE_ENV_FILES, pushFile, WORKER_PENDING, writePrivate } from './files.mjs';

/**
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 * @typedef {import('./files.mjs').EnvFileName} EnvFileName
 */

/**
 * W22: заповнює порожні значення файлів `.local/<env>/`, за `--target` надсилає всі три файли, новий секрет
 * краю — у Worker. Наявні значення ніколи не генеруються заново.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function generate(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const dir = localEnvDir(ctx, env);
  const examplesDir = ctx.paths.examplesDir;
  /** @param {string} m */
  const refuse = (m) => {
    err(`edge-secret: ${m}`);
    return 2;
  };

  // 1. Без змін: шляхи приватні, приклади є, поточний стан.
  /** @type {Record<string, string>} */
  const text = {};
  /** @type {Record<string, boolean>} */
  const created = {};
  for (const name of NODE_ENV_FILES) {
    const file = path.join(dir, name);
    await assertPrivatePath(ctx, file);
    if (fs.existsSync(file)) {
      text[name] = fs.readFileSync(file, 'utf8');
      created[name] = false;
    } else {
      const example = path.join(examplesDir, `${name}.example`);
      if (!fs.existsSync(example)) return refuse(`немає прикладу infra/ops/node/${name}.example`);
      text[name] = fs.readFileSync(example, 'utf8');
      created[name] = true;
    }
  }
  // Наявні значення — одразу в редактор: жодне не може потрапити у вивід.
  for (const name of NODE_ENV_FILES) {
    for (const line of text[name].split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/);
      if (m) ctx.redactor.add(m[1].trim());
    }
  }

  const pg = text['postgres.env'];
  const srv = text['server.env'];
  if (!getVar(pg, 'POSTGRES_PASSWORD') && getVar(srv, 'DATABASE_URI')) {
    return refuse('DATABASE_URI заповнено, а POSTGRES_PASSWORD — ні; виправте файли в .local вручну');
  }
  const pendingFile = path.join(dir, WORKER_PENDING);
  const edgeNew = !getVar(srv, 'T2F_EDGE_SECRET');
  const workerNeeded = edgeNew || fs.existsSync(pendingFile);
  const worker = workerNeeded ? ctx.deps.worker(env) : undefined;
  if (worker) {
    const missing = worker.missingCredentials();
    if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);
  }

  /** @type {Awaited<ReturnType<typeof acquireNodeLock>> | undefined} */
  let lock;
  /** @type {import('../common.mjs').Site | undefined} */
  let site;
  if (ctx.args.values.target !== undefined) {
    const resolved = resolveSite(ctx);
    if (resolved.code !== 0) return refuse(resolved.message);
    site = resolved.site;
    if (site.transport.kind === 'local') {
      for (const name of NODE_ENV_FILES) await assertPrivatePath(ctx, path.join(/** @type {string} */ (site.nodeDir), name));
    }
    lock = await acquireNodeLock(site.transport, env, site.lockOpts);
    if (lock.code !== 0) return refuse(lock.message);
  }

  try {
    // 2. Заповнення порожніх значень.
    /** @type {string[]} */
    const report = [];
    /**
     * @param {EnvFileName} file
     * @param {string} name
     * @param {() => string | undefined} make
     * @param {string} [madeWord]
     */
    const fill = (file, name, make, madeWord = 'згенеровано') => {
      if (getVar(text[file], name)) {
        report.push(`${file} ${name} — вже було`);
        return false;
      }
      const v = make();
      if (v === undefined) {
        report.push(`${file} ${name} — порожньо`);
        return false;
      }
      ctx.redactor.add(v);
      text[file] = setVar(text[file], name, v);
      report.push(`${file} ${name} — ${madeWord}`);
      return true;
    };

    fill('postgres.env', 'POSTGRES_USER', () => 't2f', 'задано');
    fill('postgres.env', 'POSTGRES_DB', () => `t2f_${env}`, 'задано');
    fill('postgres.env', 'POSTGRES_PASSWORD', newSecret);
    fill('server.env', 'PAYLOAD_SECRET', newSecret);
    fill('server.env', 'T2F_EDGE_SECRET', newSecret);
    fill('server.env', 'DATABASE_URI', () =>
      databaseUri({
        user: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_USER')),
        password: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_PASSWORD')),
        db: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_DB')),
      }),
    );
    fill('server.env', 'REDIS_URL', () => 'redis://redis:6379/0', 'задано');
    fill('server.env', 'T2F_REDIS_PREFIX', () => `t2f:${env}:`, 'задано');
    const tunnelFile = ctx.paths.tunnelEnvFile(env);
    fill('cloudflared.env', 'TUNNEL_TOKEN', () => {
      if (!fs.existsSync(tunnelFile)) return undefined;
      const v = getVar(fs.readFileSync(tunnelFile, 'utf8'), 'TUNNEL_TOKEN');
      return v || undefined;
    }, 'скопійовано з infra/cloudflare/.local');

    // Новий секрет краю: позначка «ще не в Worker’і» — до запису файлу, щоб збій не загубив його.
    if (edgeNew) writePrivate(pendingFile, '');
    for (const name of NODE_ENV_FILES) writePrivate(path.join(dir, name), text[name]);
    for (const name of NODE_ENV_FILES) if (created[name]) out(`edge-secret: ${name} створено з прикладу`);
    for (const line of report) out(`edge-secret: ${line}`);

    // 3. Надсилання на ціль.
    if (site) {
      for (const name of NODE_ENV_FILES) {
        await pushFile(site.transport, /** @type {string} */ (site.nodeDir), name, text[name]);
        out(`edge-secret: ${name} — надіслано (${site.transport.describe})`);
      }
      out('edge-secret: сервер підхопить змінені значення після наступного перезапуску (deploy)');
    }

    // 4. Секрет краю — у Worker (stdin).
    if (worker) {
      const v = /** @type {string} */ (getVar(text['server.env'], 'T2F_EDGE_SECRET'));
      const r = await worker.putSecret('T2F_EDGE_SECRET', v);
      if (r.code !== 0) {
        err(`edge-secret: ${r.message}; повторіть --generate, щоб дослати`);
        return 1;
      }
      fs.rmSync(pendingFile, { force: true });
      out('edge-secret: T2F_EDGE_SECRET — надіслано у Worker');
    }
    return 0;
  } finally {
    if (lock && lock.code === 0) await lock.release();
  }
}
