// @ts-check
// Спільне для підкоманд ops: куди діє команда (транспорт, замок, журнал), кроки в журналі, зонд простою,
// текст помилки. Нічого не знає про конкретну підкоманду; підкоманди імпортують звідси, а не одна з одної.
import path from 'node:path';
import { ENVS } from './config.mjs';
import { createJournal, journalPath } from './journal.mjs';

export const DEPLOY_USER = 'deploy';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./node.mjs').Clock} Clock
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {{
 *   server: boolean,
 *   transport: Transport,
 *   lockOpts: import('./lock.mjs').LockOpts,
 *   journal: import('./journal.mjs').Journal,
 *   project?: string,
 *   nodeDir?: string,
 * }} Site
 */

/** @param {unknown} e */
export const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * `known_hosts` для SSH: `T2F_KNOWN_HOSTS_FILE` або файл у каталозі стану.
 * @param {OpsContext} ctx
 */
export const knownHostsFile = (ctx) => ctx.env.T2F_KNOWN_HOSTS_FILE || path.join(ctx.paths.stateRoot, 'known_hosts');

/**
 * Куди діє команда: транспорт, каталог вузла, проєкт Compose, замок і журнал. Нічого не змінює.
 * @param {OpsContext} ctx
 * @returns {{ code: 0, site: Site } | { code: 2, message: string }}
 */
export function resolveSite(ctx) {
  const env = /** @type {string} */ (ctx.args.env);
  const cfg = ENVS[env];
  const stateRoot = ctx.paths.stateRoot;
  const journalOf = (/** @type {Transport} */ transport, /** @type {string} */ file) =>
    createJournal({ transport, file, env: ctx.env, redactor: ctx.redactor });

  if (!cfg.serverSteps) {
    // Лише Worker: замок і журнал — у локальному каталозі стану, без вузла й без Docker.
    const dir = path.join(stateRoot, `edge-${env}`);
    const transport = ctx.deps.transport(null);
    return { code: 0, site: { server: false, transport, lockOpts: { stateDir: dir }, journal: journalOf(transport, journalPath(dir, 'local')) } };
  }

  const target = ctx.args.values.target;
  if (!target) return { code: 2, message: `--target: обов’язковий для ${env} (local або адреса вузла)` };
  if (target === 'local') {
    const dir = path.join(stateRoot, `node-local-${env}`);
    const transport = ctx.deps.transport(null);
    return {
      code: 0,
      site: {
        server: true,
        transport,
        lockOpts: { stateDir: dir },
        journal: journalOf(transport, journalPath(dir, 'local')),
        project: cfg.localProject ?? `t2f-node-${env}`,
        nodeDir: dir,
      },
    };
  }
  if (!cfg.nodeDir) return { code: 2, message: `у середовища ${env} немає каталогу вузла` };
  /** @type {Transport} */
  let transport;
  try {
    transport = ctx.deps.transport({ host: target, user: DEPLOY_USER, knownHostsFile: knownHostsFile(ctx) });
  } catch (e) {
    return { code: 2, message: messageOf(e) };
  }
  return {
    code: 0,
    site: {
      server: true,
      transport,
      lockOpts: { nodeDir: cfg.nodeDir },
      journal: journalOf(transport, journalPath(cfg.nodeDir, 'posix')),
      project: cfg.project ?? `t2f-${env}`,
      nodeDir: cfg.nodeDir,
    },
  };
}

/**
 * Крок у журналі: запис `start`, потім `ok`/`failed` з тривалістю. Виняток кроку — невдача кроку.
 * @param {{ journal: import('./journal.mjs').Journal, env: string, commit: string | null, clock: Clock, now: () => Date }} o
 */
export function createStepper(o) {
  /**
   * @template {{ code: number }} R
   * @param {string} name
   * @param {() => Promise<R>} fn
   * @returns {Promise<R | { code: 1, message: string }>}
   */
  return async function step(name, fn) {
    const base = { kind: /** @type {const} */ ('step'), env: o.env, commit: o.commit, step: name };
    await o.journal.append({ ...base, at: o.now().toISOString(), status: 'start', ms: null });
    const t0 = o.clock.now();
    /** @type {R | { code: 1, message: string }} */
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { code: 1, message: messageOf(e) };
    }
    const ms = Math.max(0, Math.round(o.clock.now() - t0));
    await o.journal.append({ ...base, at: o.now().toISOString(), status: r.code === 0 ? 'ok' : 'failed', ms });
    return r;
  };
}

/**
 * Повідомлення й хвіст виводу кроку в stderr (маскується).
 * @param {(line: string) => void} err
 * @param {{ message?: string, detail?: string }} r
 */
export function reportFailure(err, r) {
  if (!r.detail) return;
  for (const line of String(r.detail).split(/\r?\n/).filter((l) => l.trim() !== '').slice(-20)) err(`  ${line}`);
}

/**
 * Зонд простою (`--probe`): через край для вузла, перевірка зсередини контейнера для локальної цілі.
 * @param {OpsContext} ctx
 * @param {Site} site
 * @param {import('./node.mjs').NodeOps | undefined} node
 */
export function maybeProbe(ctx, site, node) {
  if (ctx.args.flags.probe !== true) return undefined;
  const start = ctx.deps.startProbe;
  const cfg = ENVS[/** @type {string} */ (ctx.args.env)];
  if (site.transport.kind === 'local' && node) return start({ check: node.healthCheck });
  if (cfg.siteHost) return start({ url: `https://${cfg.siteHost}/api/health` });
  ctx.err(`${ctx.args.sub}: зонд простою не запущено: у середовища немає імені сайту`);
  return undefined;
}
