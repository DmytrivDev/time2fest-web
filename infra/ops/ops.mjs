// @ts-check
// Операції розгортання: `node infra/ops/ops.mjs <deploy|rollback|bootstrap|edge-secret|move-domain|capacity> …`.
// Нуль залежностей. Порядок: аргументи → запобіжник → підкоманда. Відмова аргументу чи запобіжника — код 2,
// до будь-якого виклику ssh, docker чи wrangler. Підкоманди підключаються по фазах; до того друкують `not implemented`.
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { realExec } from './lib/exec.mjs';
import { guardRun } from './lib/guard.mjs';
import { createOutput, redactorFromEnv } from './lib/redact.mjs';

const SUBCOMMANDS = ['deploy', 'rollback', 'bootstrap', 'edge-secret', 'move-domain', 'capacity'];

/**
 * @typedef {{
 *   args: import('./lib/args.mjs').ParsedArgs,
 *   env: Record<string, string | undefined>,
 *   exec: import('./lib/exec.mjs').Executor,
 *   redactor: import('./lib/redact.mjs').Redactor,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 *   now: () => Date,
 * }} OpsContext
 */

/** Реалізовані підкоманди (додаються по фазах). @type {Record<string, (ctx: OpsContext) => Promise<number>>} */
const RUNNERS = {};

/**
 * @param {string[]} argv
 * @param {{
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 *   env?: Record<string, string | undefined>,
 *   exec?: import('./lib/exec.mjs').Executor,
 *   now?: () => Date,
 * }} [deps] `exec` і `now` — підставні в тестах
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const redactor = redactorFromEnv(env);
  const { out, err } = createOutput(
    redactor,
    deps.out ?? ((/** @type {string} */ line) => console.log(line)),
    deps.err ?? deps.out ?? ((/** @type {string} */ line) => console.error(line)),
  );
  const now = deps.now ?? (() => new Date());

  const [sub, ...rest] = argv;
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    out(`usage: ops <${SUBCOMMANDS.join('|')}> …`);
    return 2;
  }

  const parsed = parseArgs(sub, rest);
  if (!parsed.ok) {
    err(`${sub}: ${parsed.message}`);
    return parsed.code;
  }
  const { args } = parsed;

  const guarded = guardRun({
    sub,
    env: args.env,
    target: args.values.target ?? args.values.host,
    hosts: args.values.name !== undefined ? [args.values.name] : [],
    flags: {
      confirm: args.values.confirm,
      allowMainDomain: args.flags['allow-main-domain'] === true,
      emergency: args.flags.emergency === true,
    },
    now: now(),
  });
  if (!guarded.ok) {
    err(`${sub}: ${guarded.message}`);
    return guarded.code;
  }

  const runner = RUNNERS[sub];
  if (!runner) {
    out(`${sub}: not implemented`);
    return 1;
  }
  return runner({ args, env, exec: deps.exec ?? realExec, redactor, out, err, now });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
