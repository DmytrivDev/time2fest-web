// @ts-check
// Розгортання (AC-9 … AC-21): чисте дерево й коміт → ціль → замок → журнал → диск ≥ 5 ГБ, потім кроки
// `build → deliver → migrate → swap → health → worker`, кожен — у журнал. Prelaunch — лише `worker`.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався. Замок знімається у `finally`.
// Розгортання ніколи не пише секретів Worker’а (AC-20) і ніколи не запускає `down` (AC-19).
import { cloudflareApiFrom } from './cloudflareApi.mjs';
import { ENVS } from './config.mjs';
import { createStepper, maybeProbe, messageOf, reportFailure, resolveSite } from './common.mjs';
import { checkDomainHolders } from './domainHolder.mjs';
import { imageTag, keepShas } from './image.mjs';
import { currentGeneration, deployedShas } from './journal.mjs';
import { acquireNodeLock } from './lock.mjs';
import { composeAt, createNode, CURRENT_ENV, NEXT_ENV } from './node.mjs';
import { workerRoutesOf } from './worker.mjs';

/**
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {import('./common.mjs').Site} Site
 */

/**
 * `ops deploy`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runDeploy(ctx) {
  const { args, out, err } = ctx;
  const env = /** @type {string} */ (args.env);
  const cfg = ENVS[env];
  /** @param {string} m */
  const refuse = (m) => {
    err(`deploy: ${m}`);
    return 2;
  };

  // 1. Перевірки без змін.
  const git = ctx.deps.git;
  const clean = await git.assertClean();
  if (clean.code !== 0) return refuse(clean.message);
  const commit = await git.resolveCommit(args.values.commit);
  if (commit.code !== 0) return refuse(commit.message);
  const sha = commit.sha;

  const worker = ctx.deps.worker(env);
  const missing = worker.missingCredentials();
  if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);
  if (!worker.hasBuild() && !worker.assetsReady()) return refuse(`статика Worker’а ${env} відсутня або порожня; спершу зберіть її`);

  // F1: хто зараз тримає ім’я робочого домену — до будь-якої зміни (і до кроків сервера production).
  if (cfg.mainDomain) {
    const held = await checkMainDomainHolder(ctx, worker.workerEnv);
    if (!held.ok) return refuse(held.message);
    if (held.taken.length) out(`deploy: ім’я забирається в ${held.taken.join(', ')} (--take-domain-from)`);
  }

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
    return await deployLocked(ctx, { site, sha, worker, composeText: composeText ?? '' });
  } finally {
    await lock.release();
  }
}

/**
 * Тримач імен маршрутів Worker’а робочого домену (F1).
 * @param {OpsContext} ctx
 * @param {string} workerEnv
 * @returns {Promise<import('./domainHolder.mjs').HolderCheck>}
 */
async function checkMainDomainHolder(ctx, workerEnv) {
  const routes = workerRoutesOf(workerEnv);
  if (!routes) return { ok: false, code: 2, message: `маршрути Worker’а ${workerEnv} не прочитано з wrangler.json` };
  const api = cloudflareApiFrom(ctx);
  if (!api) return { ok: false, code: 2, message: 'бракує змінних: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID' };
  return checkDomainHolders({ api, hosts: routes.hosts, worker: routes.name, takeFrom: ctx.args.values['take-domain-from'] });
}

/**
 * @param {OpsContext} ctx
 * @param {{ site: Site, sha: string, worker: import('./worker.mjs').Worker, composeText: string }} o
 * @returns {Promise<number>}
 */
async function deployLocked(ctx, { site, sha, worker, composeText }) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const clock = ctx.deps.clock;
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

  const image = node ? ctx.deps.image() : undefined;

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
      // S07-03: статика без заборонених підписів — до будь-якого вивантаження.
      const scan = await worker.checkBundle();
      if (scan.code !== 0) return scan;
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
