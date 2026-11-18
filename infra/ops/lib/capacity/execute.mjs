// @ts-check
// Виконання плану `capacity` (AC-46 … AC-53): кроки по черзі через порт провайдера, кожен — у журнал
// `.local/<env>/capacity.jsonl`; невдача зупиняє решту й друкує виконане. Зонд простою — для зміни розміру.
import fs from 'node:fs';
import path from 'node:path';
import { messageOf } from '../common.mjs';
import { ENVS } from '../config.mjs';
import { envTag, label, ROLE_REALTIME, ROLE_SERVER2, TAG_MANAGED } from './plan.mjs';
import { prepareRealtime, prepareServer2 } from './prepareRealtime.mjs';

export const JOURNAL_NAME = 'capacity.jsonl';
const HEALTH_WAIT_MS = 300_000;
const HEALTH_EVERY_MS = 1_000;

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('./provider.mjs').ProviderBundle} ProviderBundle
 * @typedef {import('./plan.mjs').Step} Step
 * @typedef {import('../node.mjs').Clock} Clock
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 */

/**
 * @param {import('../config.mjs').OpsPaths} paths
 * @param {string} env
 */
export function journalFile(paths, env) {
  return path.join(paths.stateRoot, env, JOURNAL_NAME);
}

/**
 * Записи журналу потужності (пошкоджені рядки пропускаються).
 * @param {string} file
 * @returns {any[]}
 */
export function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/**
 * @param {OpsContext} ctx
 * @param {{ env: string, action: string, steps: Step[], bundle: ProviderBundle, clock: Clock, composeText: string }} o
 * @returns {Promise<number>}
 */
export async function execute(ctx, o) {
  const { out, err } = ctx;
  const file = journalFile(ctx.paths, o.env);
  /** @param {Record<string, unknown>} rec */
  const journal = (rec) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: ctx.now().toISOString(), env: o.env, action: o.action, ...rec })}\n`);
  };
  /** @type {Node | undefined} вузол realtime, створений у цьому запуску */
  let created;
  /** @type {string[]} */
  const done = [];

  for (const [i, s] of o.steps.entries()) {
    const t0 = o.clock.now();
    const seconds = () => Math.max(0, Math.round((o.clock.now() - t0) / 1000));
    /** @type {{ downtimeSeconds: number } | undefined} */
    let probed;
    try {
      if (s.kind === 'resize') {
        const probe = startProbeFor(ctx, o.env);
        try {
          const r = await o.bundle.provider.resizeNode(s.node.id, s.to, { keepDisk: s.keepDisk, requireTags: [TAG_MANAGED, envTag(o.env)] });
          if (r.keepDisk !== s.keepDisk) throw new Error(`провайдер не дотримав плану щодо диска ${s.node.name}`);
          if (probe) await waitSiteHealthy(ctx, o.env, o.clock);
        } finally {
          probed = probe?.stop();
        }
      } else if (s.kind === 'create') {
        created = await o.bundle.provider.createNode({ name: s.name, region: s.region, size: s.size, tags: s.tags, ...(s.vpcId ? { vpcId: s.vpcId } : {}) });
      } else if (s.kind === 'prepare') {
        const nodeId = s.nodeId ?? created?.id;
        const role = s.role === 'server2' ? ROLE_SERVER2 : ROLE_REALTIME;
        const node = nodeId ? (await o.bundle.provider.listNodes([TAG_MANAGED, envTag(o.env), role])).find((n) => n.id === nodeId) : undefined;
        if (!node) throw new Error(`вузол ${s.role === 'server2' ? 'другого сервера' : 'realtime'} ${s.name} не знайдено`);
        if (s.role === 'server2') await prepareServer2(ctx, node, o.clock);
        else await prepareRealtime(ctx, node, o.composeText, o.clock);
        s.nodeId = node.id;
      } else {
        await o.bundle.provider.deleteNode(s.node.id, { requireTags: [TAG_MANAGED, envTag(o.env), ...(s.requireRole ? [s.requireRole] : [])] });
      }
    } catch (e) {
      const rec = stepRecord(s, created);
      journal({ ...rec, result: 'failed', seconds: seconds(), ...(probed ? { downtimeSeconds: probed.downtimeSeconds } : {}) });
      err(`capacity: крок ${i + 1} не вдався: ${label(s, o.env)}`);
      err(`  ${messageOf(e)}`);
      err(`capacity: виконано: ${done.length ? done.join('; ') : 'нічого'}`);
      err('capacity: повторний запуск продовжить з невиконаних кроків (стан читається з провайдера)');
      return 1;
    }
    const secs = seconds();
    journal({ ...stepRecord(s, created), result: 'ok', seconds: secs, ...(probed ? { downtimeSeconds: probed.downtimeSeconds } : {}) });
    const timing = probed ? `за ${secs} с, простій ${probed.downtimeSeconds} с` : `за ${secs} с`;
    out(`capacity: ${i + 1}. готово ${timing}`);
    done.push(`${i + 1}. ${label(s, o.env)}`);
  }
  out(`capacity ${o.env} ${o.action}: готово; журнал — ${file}`);
  return 0;
}

/**
 * @param {Step} s
 * @param {Node | undefined} created
 */
function stepRecord(s, created) {
  switch (s.kind) {
    case 'resize':
      return { step: 'resize', node: s.node.name, nodeId: s.node.id, from: s.from, to: s.to };
    case 'create':
      return { step: 'create', node: s.name, nodeId: created?.id ?? null, to: s.size };
    case 'prepare':
      return { step: 'prepare', node: s.name, nodeId: s.nodeId ?? created?.id ?? null };
    case 'delete':
      return { step: 'delete', node: s.node.name, nodeId: s.node.id };
  }
}

/**
 * Зонд простою (`--probe`, AC-53) через край: `https://<siteHost>/api/health`.
 * @param {OpsContext} ctx
 * @param {string} env
 */
function startProbeFor(ctx, env) {
  if (ctx.args.flags.probe !== true) return undefined;
  const host = ENVS[env]?.siteHost;
  if (!host) {
    ctx.err(`capacity: зонд простою не запущено: у середовища ${env} немає імені сайту`);
    return undefined;
  }
  return ctx.deps.startProbe({ url: `https://${host}/api/health` });
}

/**
 * Після зміни розміру — чекати першої відповіді 200 сайту, щоб зонд захопив увесь простій (до 300 с).
 * @param {OpsContext} ctx
 * @param {string} env
 * @param {Clock} clock
 */
async function waitSiteHealthy(ctx, env, clock) {
  const host = ENVS[env]?.siteHost;
  const doFetch = ctx.deps.fetch;
  const deadline = clock.now() + HEALTH_WAIT_MS;
  for (;;) {
    const ok = await doFetch(`https://${host}/api/health`, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.status === 200,
      () => false,
    );
    if (ok) return;
    if (clock.now() >= deadline) throw new Error(`сайт ${host} не відповів 200 за ${HEALTH_WAIT_MS / 1000} с після зміни розміру`);
    await clock.sleep(HEALTH_EVERY_MS);
  }
}
