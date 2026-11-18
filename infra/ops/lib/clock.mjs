// @ts-check
// `ops clock` (O·P16, AC-54, AC-55, AC-65): керування віртуальним часом репетиції через SSH — один виклик
// `docker compose … exec -T server pnpm run clock <дія>` на вузлі. Нового HTTP-входу немає. Лише `rehearsal`:
// інше середовище відмовляє на розборі аргументів (код 2) до будь-якого з’єднання.
// Контракт CLI вузла (`server/src/cli/clock.ts`, W35): `status | set --at <ISO> | real | restart-night |
// speed <0..600> | records [--epoch N]`; один JSON-рядок у stdout; код 0 — виконано, 2 — відмова (не rehearsal/test чи
// недопустимий аргумент), інше — збій. Виконавець у журналі сервера — `ops` (його ставить сам CLI).
import { ENVS } from './config.mjs';
import { messageOf, resolveSite } from './common.mjs';
import { composeArgv, CURRENT_ENV } from './node.mjs';
import { drillJournal } from './privateDb.mjs';

const CALL_TIMEOUT_MS = 60_000;
/** Дії, що змінюють стан годинника (журналяться локально); `status` і `records` лише читають. */
const MUTATING = new Set(['set', 'real', 'restart-night', 'speed']);

/**
 * Аргументи дії для CLI вузла (після `pnpm run clock`) або пояснення відмови за недопустимого поєднання прапорців.
 * @param {string} action
 * @param {Record<string, string>} values
 * @returns {{ argv: string[] } | { message: string }}
 */
export function clockCliArgs(action, values) {
  const allowed = { set: ['at'], speed: ['speed'], records: ['epoch'] }[/** @type {'set' | 'speed' | 'records'} */ (action)] ?? [];
  const stray = ['at', 'speed', 'epoch'].find((k) => values[k] !== undefined && !allowed.includes(k));
  if (stray) return { message: `--${stray}: не для дії ${action}` };
  if (action === 'set') return values.at === undefined ? { message: 'set: потрібен --at <ISO UTC>' } : { argv: ['set', '--at', values.at] };
  if (action === 'speed') return values.speed === undefined ? { message: 'speed: потрібен --speed <0..600>' } : { argv: ['speed', values.speed] };
  if (action === 'records') return { argv: values.epoch === undefined ? ['records'] : ['records', '--epoch', values.epoch] };
  return { argv: [action] };
}

/**
 * `ops clock <status|set|real|restart-night|speed|records> --env rehearsal --target <host> [--at ISO] [--speed N] [--epoch N]`.
 * @param {import('../ops.mjs').OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runClock(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const action = /** @type {string} */ (ctx.args.action);
  /** @param {string} m */
  const refuse = (m) => {
    err(`clock: ${m}`);
    return 2;
  };
  if (env !== 'rehearsal' || !ENVS[env]?.nodeDir) return refuse('лише --env rehearsal');
  const cli = clockCliArgs(action, ctx.args.values);
  if ('message' in cli) return refuse(cli.message);

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  if (site.transport.kind !== 'ssh' || !site.nodeDir || !site.project) return refuse('лише вузол (--target — адреса вузла)');

  const argv = composeArgv({ project: site.project, nodeDir: site.nodeDir, local: false }, CURRENT_ENV, ['exec', '-T', 'server', 'pnpm', 'run', 'clock', ...cli.argv]);
  const journal = drillJournal(ctx, env, { sub: 'clock', actor: 'ops', action });
  try {
    const r = await site.transport.exec(argv, { timeoutMs: CALL_TIMEOUT_MS });
    // JSON-рядок CLI — останній непорожній рядок stdout (pnpm може друкувати службові рядки перед ним).
    const json = String(r.stdout).split(/\r?\n/).filter((l) => l.trim() !== '').at(-1);
    if (MUTATING.has(action)) journal.append({ step: 'clock', result: r.code === 0 ? 'ok' : 'failed', args: cli.argv });
    if (r.code !== 0) {
      err(`clock: ${action} не виконано (код ${r.code})`);
      for (const l of String(r.stderr).split(/\r?\n/).filter((x) => x.trim() !== '').slice(-10)) err(`  ${l}`);
      return r.code === 2 ? 2 : 1;
    }
    if (json === undefined) {
      err(`clock: ${action}: CLI вузла не повернув JSON-рядка`);
      return 1;
    }
    out(json);
    return 0;
  } catch (e) {
    err(`clock: ${messageOf(e)}`);
    return 1;
  }
}
