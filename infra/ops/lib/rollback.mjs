// @ts-check
// Відкат (AC-24 … AC-27): замок → журнал → ціль = останнє успішне розгортання. Спершу Worker на його
// `workerVersionBefore`, потім контейнер сервера на `imageBefore` (або `--to`), перевірка здоров’я, `current.env`.
// Жодних міграцій і жодного запису у файли змінних вузла (AC-25). Відмова до змін — код 2; крок не вдався — 1.
import { currentGeneration, lastOk } from './journal.mjs';
import { imageTag, shaOfImage } from './image.mjs';
import { acquireNodeLock } from './lock.mjs';
import { createNode, NEXT_ENV } from './node.mjs';
import { createStepper, maybeProbe, messageOf, reportFailure, resolveSite } from './common.mjs';

/** Пояснення відмови за поколінням секрету краю (AC-27). */
export const GENERATION_REFUSAL = 'секрет краю замінено після цього розгортання; відкат Worker’а заборонено';

/**
 * `ops rollback`.
 * @param {import('../ops.mjs').OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runRollback(ctx) {
  const env = /** @type {string} */ (ctx.args.env);
  /** @param {string} m */
  const refuse = (m) => {
    ctx.err(`rollback: ${m}`);
    return 2;
  };

  const worker = ctx.deps.worker(env);
  const missing = worker.missingCredentials();
  if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  try {
    return await rollbackLocked(ctx, site, worker, refuse);
  } finally {
    await lock.release();
  }
}

/**
 * @param {import('../ops.mjs').OpsContext} ctx
 * @param {import('./common.mjs').Site} site
 * @param {import('./worker.mjs').Worker} worker
 * @param {(m: string) => number} refuse
 * @returns {Promise<number>}
 */
async function rollbackLocked(ctx, site, worker, refuse) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const clock = ctx.deps.clock;
  const startedAt = clock.now();

  // Перевірки без змін: ціль відкату, покоління секрету, наявність образу, поточний стан.
  /** @type {import('./journal.mjs').OutcomeRecord} */
  let rec;
  /** @type {string | null} */
  let target = null;
  /** @type {string | null} */
  let current = null;
  /** @type {string | null} */
  let versionNow;
  /** @type {import('./node.mjs').NodeOps | undefined} */
  let node;
  let generation;
  try {
    const records = await site.journal.read();
    const found = lastOk(records, env);
    if (!found) return refuse(`у журналі немає успішного розгортання ${env}; відкочувати нема на що`);
    rec = found;
    if (!rec.workerVersionBefore) return refuse('в останньому успішному розгортанні немає версії Worker’а до нього');
    generation = currentGeneration(records, env);
    if (rec.edgeSecretGeneration < generation) return refuse(GENERATION_REFUSAL);
    if (site.server) {
      target = ctx.args.values.to ?? shaOfImage(rec.imageBefore);
      if (!target) return refuse('немає образу, на який повертати (imageBefore порожній); вкажіть --to <sha>');
      const inspect = await site.transport.exec(['docker', 'image', 'inspect', imageTag(target)], { timeoutMs: 60_000 });
      if (inspect.code !== 0) return refuse(`на вузлі немає образу ${imageTag(target)}`);
      node = createNode({ transport: site.transport, env, project: /** @type {string} */ (site.project), nodeDir: /** @type {string} */ (site.nodeDir), clock });
      current = await node.readCurrent();
    }
    const v = await worker.currentVersion();
    if (v.code !== 0) return refuse(v.message);
    versionNow = v.version;
  } catch (e) {
    return refuse(messageOf(e));
  }

  const versionTarget = /** @type {string} */ (rec.workerVersionBefore);
  const step = createStepper({ journal: site.journal, env, commit: target, clock, now: ctx.now });
  const probe = maybeProbe(ctx, site, node);
  const downtime = () => {
    const r = probe?.stop();
    return r ? { downtimeSeconds: r.downtimeSeconds } : {};
  };

  /**
   * @param {import('./journal.mjs').OutcomeResult} result
   * @param {string | null} failedStep
   * @param {string | null} imageAfter
   * @param {string | null} versionAfter
   */
  const outcome = async (result, failedStep, imageAfter, versionAfter) => {
    const extra = downtime();
    // Тривалість усієї команди (NFR-1) — окремий запис кроку `total`.
    await site.journal.append({
      kind: 'step',
      at: ctx.now().toISOString(),
      env,
      commit: target,
      step: 'total',
      status: result === 'rolled-back' ? 'ok' : 'failed',
      ms: Math.max(0, Math.round(clock.now() - startedAt)),
    });
    await site.journal.append({
      kind: 'rollback',
      at: ctx.now().toISOString(),
      env,
      commit: target,
      imageBefore: current ? imageTag(current) : null,
      imageAfter,
      workerVersionBefore: versionNow,
      workerVersionAfter: versionAfter,
      edgeSecretGeneration: generation,
      result,
      failedStep,
      ...extra,
    });
  };

  try {
    out(`rollback: ${env}: Worker → ${versionTarget}${target ? `, сервер → ${target.slice(0, 12)}` : ''}`);
    const w = await step('worker-rollback', () => worker.rollback(versionTarget));
    if (w.code !== 0) {
      err(`rollback: відкат Worker’а не вдався: ${'message' in w ? w.message : ''}; сервер не змінювався`);
      await outcome('failed', 'worker-rollback', current ? imageTag(current) : null, versionNow);
      return 1;
    }

    if (node && target) {
      const n = node;
      const sha = target;
      const swapped = await step('swap', async () => {
        await n.prepare(sha);
        return n.swap(NEXT_ENV);
      });
      const healthy = swapped.code === 0 ? await step('health', () => n.waitHealthy(NEXT_ENV, sha)) : swapped;
      if (healthy.code !== 0) {
        // EC-8: Worker уже повернено, сервер — ні.
        err(`rollback: Worker повернено на ${versionTarget}, але сервер не став здоровим на ${sha.slice(0, 12)}: ${'message' in healthy ? healthy.message : ''}`);
        reportFailure(err, healthy);
        await outcome('failed', swapped.code === 0 ? 'health' : 'swap', null, versionTarget);
        return 1;
      }
      await n.setCurrent(sha);
    }

    await outcome('rolled-back', null, target ? imageTag(target) : null, versionTarget);
    out(`rollback: ${env} готово за ${Math.round((clock.now() - startedAt) / 1000)} с`);
    return 0;
  } catch (e) {
    err(`rollback: ${messageOf(e)}`);
    downtime();
    return 1;
  }
}
