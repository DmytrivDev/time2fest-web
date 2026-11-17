// @ts-check
// Розгортання (AC-9 … AC-21): чисте дерево й коміт → ціль → замок → журнал → диск ≥ 5 ГБ, потім кроки
// `build → deliver → migrate → swap → health → worker`, кожен — у журнал. Prelaunch — лише `worker`.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався. Замок знімається у `finally`.
// Розгортання ніколи не пише секретів Worker’а (AC-20) і ніколи не запускає `down` (AC-19).
import path from 'node:path';
import { ENVS } from './config.mjs';
import { REPO_ROOT } from './exec.mjs';
import { createGit } from './git.mjs';
import { createImage, imageTag, keepShas } from './image.mjs';
import { createJournal, currentGeneration, deployedShas, journalPath } from './journal.mjs';
import { acquireNodeLock } from './lock.mjs';
import { composeAt, createNode, CURRENT_ENV, NEXT_ENV, SYSTEM_CLOCK } from './node.mjs';
import { startProbe as realStartProbe } from './probe.mjs';
import { createWorker } from './worker.mjs';

/** Каталог локального стану ops (не в git): замки й журнали локальної цілі, `known_hosts`. */
export const DEFAULT_STATE_ROOT = path.join(REPO_ROOT, 'infra', 'ops', '.local');
export const DEPLOY_USER = 'deploy';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./node.mjs').Clock} Clock
 * @typedef {{
 *   transport?: Transport,
 *   worker?: import('./worker.mjs').Worker,
 *   clock?: Clock,
 *   git?: import('./git.mjs').Git,
 *   image?: import('./image.mjs').Image,
 *   stateRoot?: string,
 *   startProbe?: typeof realStartProbe,
 * }} OpsDeps Підставні залежності (тести); без них — справжні.
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
 * Куди діє команда: транспорт, каталог вузла, проєкт Compose, замок і журнал. Нічого не змінює.
 * @param {OpsContext} ctx
 * @returns {{ code: 0, site: Site } | { code: 2, message: string }}
 */
export function resolveSite(ctx) {
  const env = /** @type {string} */ (ctx.args.env);
  const cfg = ENVS[env];
  const deps = ctx.deps ?? {};
  const stateRoot = deps.stateRoot ?? DEFAULT_STATE_ROOT;
  const journalOf = (/** @type {Transport} */ transport, /** @type {string} */ file) =>
    createJournal({ transport, file, env: ctx.env, redactor: ctx.redactor });

  if (!cfg.serverSteps) {
    // Лише Worker: замок і журнал — у локальному каталозі стану, без вузла й без Docker.
    const dir = path.join(stateRoot, `edge-${env}`);
    const transport = deps.transport ?? ctx.exec.localTransport();
    return { code: 0, site: { server: false, transport, lockOpts: { stateDir: dir }, journal: journalOf(transport, journalPath(dir, 'local')) } };
  }

  const target = ctx.args.values.target;
  if (!target) return { code: 2, message: `--target: обов’язковий для ${env} (local або адреса вузла)` };
  if (target === 'local') {
    const dir = path.join(stateRoot, `node-local-${env}`);
    const transport = deps.transport ?? ctx.exec.localTransport();
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
    transport =
      deps.transport ??
      ctx.exec.sshTransport({
        host: target,
        user: DEPLOY_USER,
        knownHostsFile: ctx.env.T2F_KNOWN_HOSTS_FILE || path.join(stateRoot, 'known_hosts'),
      });
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
  const start = ctx.deps?.startProbe ?? realStartProbe;
  const cfg = ENVS[/** @type {string} */ (ctx.args.env)];
  if (site.transport.kind === 'local' && node) return start({ check: node.healthCheck });
  if (cfg.siteHost) return start({ url: `https://${cfg.siteHost}/api/health` });
  ctx.err(`${ctx.args.sub}: зонд простою не запущено: у середовища немає імені сайту`);
  return undefined;
}

/**
 * `ops deploy`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runDeploy(ctx) {
  const { args, out, err } = ctx;
  const env = /** @type {string} */ (args.env);
  const cfg = ENVS[env];
  const deps = ctx.deps ?? {};
  /** @param {string} m */
  const refuse = (m) => {
    err(`deploy: ${m}`);
    return 2;
  };

  // 1. Перевірки без змін.
  const git = deps.git ?? createGit({ exec: ctx.exec, start: ctx.exec.start });
  const clean = await git.assertClean();
  if (clean.code !== 0) return refuse(clean.message);
  const commit = await git.resolveCommit(args.values.commit);
  if (commit.code !== 0) return refuse(commit.message);
  const sha = commit.sha;

  const worker = deps.worker ?? createWorker({ env, processEnv: ctx.env, run: ctx.exec.run, out });
  const missing = worker.missingCredentials();
  if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);
  if (!worker.hasBuild() && !worker.assetsReady()) return refuse(`статика Worker’а ${env} відсутня або порожня; спершу зберіть її`);

  /** @type {string | undefined} */
  let composeText;
  if (cfg.serverSteps) {
    const c = await composeAt(ctx.exec.run, sha);
    if (c.code !== 0) return refuse(c.message);
    composeText = c.text;
  }

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  try {
    return await deployLocked(ctx, { site, sha, worker, git, composeText: composeText ?? '' });
  } finally {
    await lock.release();
  }
}

/**
 * @param {OpsContext} ctx
 * @param {{ site: Site, sha: string, worker: import('./worker.mjs').Worker, git: import('./git.mjs').Git, composeText: string }} o
 * @returns {Promise<number>}
 */
async function deployLocked(ctx, { site, sha, worker, git, composeText }) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const deps = ctx.deps ?? {};
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const short = sha.slice(0, 12);

  // Ще без змін: стан журналу, поточна версія Worker’а, поточний образ, диск.
  /** @type {import('./journal.mjs').JournalRecord[]} */
  let records;
  /** @type {string | null} */
  let versionBefore;
  /** @type {string | null} */
  let previous = null;
  /** @type {import('./node.mjs').NodeOps | undefined} */
  let node;
  try {
    records = await site.journal.read();
    const v = await worker.currentVersion();
    if (v.code !== 0) {
      err(`deploy: ${v.message}`);
      return 2;
    }
    versionBefore = v.version;
    if (site.server) {
      node = createNode({ transport: site.transport, env, project: /** @type {string} */ (site.project), nodeDir: /** @type {string} */ (site.nodeDir), clock });
      previous = await node.readCurrent();
      const free = await node.freeBytes(composeText);
      if (free.code !== 0) {
        err(`deploy: ${free.message}`);
        return 2;
      }
    }
  } catch (e) {
    err(`deploy: ${messageOf(e)}`);
    return 2;
  }
  const generation = currentGeneration(records, env);
  const step = createStepper({ journal: site.journal, env, commit: sha, clock, now: ctx.now });
  /** @type {ReturnType<typeof maybeProbe>} */
  let probe;
  const stopProbe = () => {
    const r = probe?.stop();
    return r ? { downtimeSeconds: r.downtimeSeconds } : {};
  };

  /**
   * @param {import('./journal.mjs').OutcomeResult} result
   * @param {string | null} failedStep
   * @param {string | null} imageAfter
   * @param {string | null} versionAfter
   */
  const outcome = (result, failedStep, imageAfter, versionAfter) =>
    site.journal.append({
      kind: 'deploy',
      at: ctx.now().toISOString(),
      env,
      commit: sha,
      imageBefore: previous ? imageTag(previous) : null,
      imageAfter,
      workerVersionBefore: versionBefore,
      workerVersionAfter: versionAfter,
      edgeSecretGeneration: generation,
      result,
      failedStep,
      ...stopProbe(),
    });

  const image = node ? (deps.image ?? createImage({ local: ctx.exec.localTransport(), git, start: ctx.exec.start })) : undefined;

  try {
    // 2. Кроки сервера.
    if (node && image) {
      const n = node;
      const prevImage = previous ? imageTag(previous) : null;
      out(`deploy: ${env} ← ${short}`);

      const built = await step('build', () => image.buildImage(sha));
      if (built.code !== 0) return await failServer('build', built, 'збірка образу', prevImage);

      const delivered = await step('deliver', async () => {
        const d = await image.deliver(site.transport, sha);
        if (d.code !== 0) return d;
        await n.uploadCompose(composeText);
        await n.prepare(sha);
        return { code: /** @type {const} */ (0) };
      });
      if (delivered.code !== 0) return await failServer('deliver', delivered, 'доставка образу', prevImage);

      const migrated = await step('migrate', () => n.migrate());
      if (migrated.code !== 0) {
        err(`deploy: крок міграції не вдався: ${'message' in migrated ? migrated.message : ''}`);
        reportFailure(err, migrated);
        err('deploy: попередній контейнер сервера лишився, Worker не розгортався');
        await outcome('failed', 'migrate', prevImage, versionBefore);
        return 1;
      }

      probe = maybeProbe(ctx, site, n);
      const swapped = await step('swap', () => n.swap(NEXT_ENV));
      const healthy = swapped.code === 0 ? await step('health', () => n.waitHealthy(NEXT_ENV, sha)) : swapped;
      if (healthy.code !== 0) {
        const failedStep = swapped.code === 0 ? 'health' : 'swap';
        err(`deploy: новий сервер не став здоровим: ${'message' in healthy ? healthy.message : ''}`);
        reportFailure(err, healthy);
        let after = null;
        if (previous) {
          const prev = previous;
          const back = await step('swap-back', async () => {
            const s = await n.swap(CURRENT_ENV);
            return s.code === 0 ? n.waitHealthy(CURRENT_ENV, prev) : s;
          });
          if (back.code === 0) {
            after = prevImage;
            err(`deploy: сервер повернено на попередній образ ${prev.slice(0, 12)}; Worker не розгортався`);
          } else {
            err(`deploy: повернення на попередній образ ${prev.slice(0, 12)} не вдалося: ${'message' in back ? back.message : ''}`);
          }
        } else {
          err('deploy: попереднього образу немає — повертати нема на що; Worker не розгортався');
        }
        await outcome('failed', failedStep, after, versionBefore);
        return 1;
      }
      await n.setCurrent(sha);
    }

    // 3. Worker (для prelaunch — єдиний крок).
    /** @type {string | null} */
    let versionAfter = null;
    const deployed = await step('worker', async () => {
      if (worker.hasBuild()) {
        const b = await worker.buildSite();
        if (b.code !== 0) return b;
      }
      const d = await worker.deploy();
      if (d.code === 0) versionAfter = d.version;
      return d;
    });
    if (deployed.code !== 0) {
      err(`deploy: крок Worker не вдався: ${'message' in deployed ? deployed.message : ''}`);
      if (node) err(`deploy: новий сервер ${short} лишився (FR-MIG-07); повторіть розгортання або відкат`);
      await outcome('worker-failed', 'worker', node ? imageTag(sha) : null, versionBefore);
      return 1;
    }

    await outcome('ok', null, node ? imageTag(sha) : null, versionAfter);
    out(`deploy: ${env} ← ${short} готово; Worker ${versionAfter ?? '-'}`);

    // 4. Прибирання старих образів (AC-16): невдача не скасовує розгортання.
    if (node && image) {
      const keep = keepShas({ current: sha, previous, deployed: [sha, ...deployedShas(records, env)] });
      const kept = await image.retain(site.transport, keep);
      if (kept.failed.length) err(`deploy: не вдалося прибрати образи: ${kept.failed.map((s) => s.slice(0, 12)).join(', ')}`);
    }
    return 0;
  } catch (e) {
    err(`deploy: ${messageOf(e)}`);
    stopProbe();
    return 1;
  }

  /**
   * Крок до міграцій не вдався: сервер не мінявся, Worker не розгортався.
   * @param {string} name
   * @param {{ code: number, message?: string, detail?: string }} r
   * @param {string} what
   * @param {string | null} prevImage
   */
  async function failServer(name, r, what, prevImage) {
    err(`deploy: ${what} не вдалася: ${r.message ?? ''}`);
    reportFailure(err, r);
    await outcome('failed', name, prevImage, versionBefore);
    return 1;
  }
}
