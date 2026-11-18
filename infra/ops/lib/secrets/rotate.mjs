// @ts-check
// `ops edge-secret --rotate` (AC-38, W23): заміна секрету краю під замком вузла у два значення
// (новий + старий як PREVIOUS), перевірка через край, потім без PREVIOUS і покоління +1.
import fs from 'node:fs';
import path from 'node:path';
import { createStepper, resolveSite } from '../common.mjs';
import { ENVS } from '../config.mjs';
import { currentGeneration } from '../journal.mjs';
import { acquireNodeLock } from '../lock.mjs';
import { createNode, CURRENT_ENV } from '../node.mjs';
import { getVar, newSecret, removeVar, setVar } from './envFile.mjs';
import { assertPrivatePath, localEnvDir, pushFile, writePrivate } from './files.mjs';

const EDGE_CHECK_ATTEMPTS = 10;
const EDGE_CHECK_EVERY_MS = 3_000;
const PROBE_CALL_TIMEOUT_MS = 10_000;

/** @typedef {import('../../ops.mjs').OpsContext} OpsContext */

/**
 * W23: заміна секрету краю під замком вузла. (1) сервер: новий + старий як PREVIOUS, перезапуск, здоров’я;
 * (2) новий — у Worker; (3) перевірка через край; (4) без PREVIOUS, перезапуск, здоров’я; (5) покоління +1.
 * Невдача (3) зупиняє все: PREVIOUS лишається, обидва значення працюють.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function rotate(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const cfg = ENVS[env];
  /** @param {string} m */
  const refuse = (m) => {
    err(`edge-secret: ${m}`);
    return 2;
  };

  if (ctx.args.values.target === undefined) return refuse('--target: обов’язковий для --rotate (local або адреса вузла)');
  const localFile = path.join(localEnvDir(ctx, env), 'server.env');
  await assertPrivatePath(ctx, localFile);
  if (!fs.existsSync(localFile)) return refuse('немає .local server.env — спершу --generate');
  let text = fs.readFileSync(localFile, 'utf8');
  const old = getVar(text, 'T2F_EDGE_SECRET');
  if (!old) return refuse('у .local server.env порожній T2F_EDGE_SECRET — спершу --generate');
  ctx.redactor.add(old);
  const prevLeft = getVar(text, 'T2F_EDGE_SECRET_PREVIOUS');
  if (prevLeft) ctx.redactor.add(prevLeft);

  const worker = ctx.deps.worker(env);
  const missing = worker.missingCredentials();
  if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  const nodeDir = /** @type {string} */ (site.nodeDir);
  if (site.transport.kind === 'local') await assertPrivatePath(ctx, path.join(nodeDir, 'server.env'));

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  try {
    const clock = ctx.deps.clock;
    const node = createNode({ transport: site.transport, env, project: /** @type {string} */ (site.project), nodeDir, clock });
    const records = await site.journal.read();
    const generation = currentGeneration(records, env);
    const running = await node.readCurrent();
    if (!running) return refuse('на вузлі немає працюючого сервера (current.env) — спершу deploy');

    const fresh = newSecret();
    ctx.redactor.add(fresh);
    const step = createStepper({ journal: site.journal, env, commit: running, clock, now: ctx.now });

    /**
     * Спершу вузол, потім локальний оригінал: невдале надсилання лишає `.local` таким, як на вузлі, і повторний
     * запуск бере за «старий» секрет те значення, яке Worker справді має.
     * @param {string} next
     */
    const pushServerEnv = async (next) => {
      await pushFile(site.transport, nodeDir, 'server.env', next);
      writePrivate(localFile, next);
      text = next;
    };
    const restart = async () => {
      const s = await node.swap(CURRENT_ENV);
      return s.code === 0 ? node.waitHealthy(CURRENT_ENV, running) : s;
    };

    const localCheck = async () => {
      const argv = node.argv(CURRENT_ENV, ['exec', '-T', 'server', 'node', 'scripts/health-probe.mjs', '--secret', 'current']);
      return (await site.transport.exec(argv, { timeoutMs: PROBE_CALL_TIMEOUT_MS })).code === 0;
    };
    const startProbe = ctx.deps.startProbe;
    const probe =
      ctx.args.flags.probe !== true
        ? undefined
        : site.transport.kind === 'local'
          ? startProbe({ check: localCheck })
          : cfg.siteHost
            ? startProbe({ url: `https://${cfg.siteHost}/api/health` })
            : undefined;
    const stopProbe = () => {
      const r = probe?.stop();
      if (r) out(`edge-secret: простій ${r.downtimeSeconds} с (проб ${r.samples}, невдалих ${r.failures})`);
    };

    let workerHasNew = false;
    const bumpGeneration = () => site.journal.append({ kind: 'edge-secret', at: ctx.now().toISOString(), env, generation: generation + 1 });
    /** @param {string} what @param {{ code: number, message?: string }} r */
    const fail = async (what, r) => {
      err(`edge-secret: ${what}: ${r.message ?? `код ${r.code}`}`);
      stopProbe();
      // Worker уже з новим секретом: покоління змінилося, навіть якщо далі не вдалося (відкат Worker’а повернув би старий).
      if (workerHasNew) await bumpGeneration();
      return 1;
    };

    out(`edge-secret: ${env} — заміна секрету краю (${site.transport.describe})`);
    // (1) Сервер приймає обидва.
    const both = await step('edge-secret:server', async () => {
      await pushServerEnv(setVar(setVar(text, 'T2F_EDGE_SECRET_PREVIOUS', old), 'T2F_EDGE_SECRET', fresh));
      return restart();
    });
    if (both.code !== 0) return await fail('сервер з новим і старим секретом не став здоровим', both);
    out('edge-secret: 1/4 сервер приймає новий і старий секрет');

    // (2) Worker — новий.
    const put = await step('edge-secret:worker', () => worker.putSecret('T2F_EDGE_SECRET', fresh));
    if (put.code !== 0) return await fail('секрет Worker’а не записано', put);
    workerHasNew = true;
    out('edge-secret: 2/4 Worker з новим секретом');

    // (3) Перевірка через край.
    const checked = await step('edge-secret:check', async () => {
      if (site.transport.kind === 'local') {
        return (await localCheck()) ? { code: /** @type {const} */ (0) } : { code: /** @type {const} */ (1), message: 'health-probe з поточним секретом не дав 200' };
      }
      if (!cfg.siteHost) return { code: /** @type {const} */ (1), message: 'у середовища немає імені сайту' };
      const url = `https://${cfg.siteHost}/api/health`;
      const check = ctx.deps.edgeCheck;
      for (let i = 0; i < EDGE_CHECK_ATTEMPTS; i++) {
        if (await check(url)) return { code: /** @type {const} */ (0) };
        if (i < EDGE_CHECK_ATTEMPTS - 1) await clock.sleep(EDGE_CHECK_EVERY_MS);
      }
      return { code: /** @type {const} */ (1), message: `GET ${url} не дав 200 за ${EDGE_CHECK_ATTEMPTS} спроб` };
    });
    if (checked.code !== 0) {
      err('edge-secret: T2F_EDGE_SECRET_PREVIOUS лишився на сервері — обидва значення приймаються; з’ясуйте причину й повторіть --rotate');
      return await fail('перевірка через край не пройшла', checked);
    }
    out('edge-secret: 3/4 край відповідає 200');

    // (4) Без PREVIOUS.
    const dropped = await step('edge-secret:drop-previous', async () => {
      await pushServerEnv(removeVar(text, 'T2F_EDGE_SECRET_PREVIOUS'));
      return restart();
    });
    if (dropped.code !== 0) return await fail('сервер без старого секрету не став здоровим', dropped);
    out('edge-secret: 4/4 старий секрет прибрано');

    // (5) Покоління.
    await bumpGeneration();
    stopProbe();
    out(`edge-secret: готово; покоління секрету краю ${generation + 1}`);
    return 0;
  } finally {
    await lock.release();
  }
}
