// @ts-check
// `ops backup --env <env> --target <local|вузол> --now` (SPEC-13b W43, AC-52): позачергова копія бази на вузлі —
// `pnpm run ops backup-now` у контейнері сервера через наявний транспорт (`composeArgv`, `exec`), під замком
// середовища (deploy не замінить контейнер посеред копії). Друкує ключ і маніфест, пише крок у журнал вузла.
// Сама копія — у сервері (ті самі захисти бакета й префікса, оренда `ops-backup`, тривога при збої).
// Коди: 0 — копію зроблено; 2 — відмова до копії (середовище, ціль, замок, копія не налаштована, оренда зайнята);
// 1 — збій копії чи виклику.
import { messageOf, resolveSite } from './common.mjs';
import { ENVS } from './config.mjs';
import { acquireNodeLock } from './lock.mjs';
import { createNode, CURRENT_ENV } from './node.mjs';

/** Довше за найдовшу копію (NFR-2: ≤5 хв на нинішньому розмірі) з великим запасом. */
export const BACKUP_TIMEOUT_MS = 30 * 60_000;
/** Команда в контейнері сервера (AC-52). */
export const BACKUP_NOW_ARGS = /** @type {const} */ (['exec', '-T', 'server', 'pnpm', 'run', 'ops', 'backup-now']);
const RE_SHA40 = /^[0-9a-f]{40}$/;

/**
 * Відповідь серверної команди — ОСТАННІЙ рядок stdout (рядки бібліотек і журналу йдуть раніше).
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function lastJsonLine(stdout) {
  const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || !last.startsWith('{')) return null;
  try {
    const v = JSON.parse(last);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * `ops backup`.
 * @param {import('../ops.mjs').OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runBackup(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  /** @param {string} m */
  const refuse = (m) => {
    err(`backup: ${m}`);
    return 2;
  };
  if (!ENVS[env]?.serverSteps) return refuse(`у середовища ${env} немає сервера й бази — копіювати нічого`);
  const confirm = ctx.args.values.confirm;
  if (confirm !== undefined && confirm !== env) return refuse(`--confirm ${confirm} не збігається з --env ${env}`);

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  const clock = ctx.deps.clock;
  const t0 = clock.now();
  /** @type {string | null} */
  let commit = null;
  /** @param {'ok' | 'failed'} status */
  const journalStep = async (status) => {
    try {
      await site.journal.append({ kind: 'step', at: ctx.now().toISOString(), env, commit, step: 'backup-now', status, ms: Math.max(0, Math.round(clock.now() - t0)) });
    } catch (e) {
      err(`backup: журнал не записано: ${messageOf(e)}`);
    }
  };
  try {
    const node = createNode({ transport: site.transport, env, project: /** @type {string} */ (site.project), nodeDir: /** @type {string} */ (site.nodeDir), clock });
    const current = await node.readCurrent();
    if (!current) return refuse('на вузлі немає працюючого сервера (current.env порожній) — спершу deploy');
    out(`backup: ${env}: позачергова копія на ${site.transport.describe} (сервер ${current.slice(0, 12)})`);
    const r = await site.transport.exec(node.argv(CURRENT_ENV, [...BACKUP_NOW_ARGS]), { timeoutMs: BACKUP_TIMEOUT_MS });
    const answer = lastJsonLine(r.stdout);
    if (r.code === 0 && answer?.ok === true && typeof answer.key === 'string') {
      const manifest = /** @type {Record<string, unknown>} */ (answer.manifest ?? {});
      if (typeof manifest.commit === 'string' && RE_SHA40.test(manifest.commit)) commit = manifest.commit;
      await journalStep('ok');
      out(`backup: ключ ${answer.key}`);
      out(`backup: маніфест ${JSON.stringify(manifest)}`);
      out(`backup: готово за ${Math.round((clock.now() - t0) / 1000)} с`);
      return 0;
    }
    await journalStep('failed');
    // Сервер друкує причину в stderr без значень середовища; ops показує її хвіст (маскується редактором).
    for (const line of String(r.stderr).split(/\r?\n/).filter((l) => l.trim() !== '').slice(-5)) err(`  ${line}`);
    if (r.code === 2) return refuse('сервер відмовив у копії (див. причину вище)');
    err(`backup: копія не вдалася (код ${r.code}${r.timedOut ? ', час вичерпано' : ''})`);
    return 1;
  } catch (e) {
    await journalStep('failed');
    err(`backup: ${messageOf(e)}`);
    return 1;
  } finally {
    await lock.release();
  }
}
