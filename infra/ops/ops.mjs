// @ts-check
// Операції розгортання: `node infra/ops/ops.mjs <deploy|rollback|bootstrap|edge-secret|move-domain|capacity> …`.
// Нуль залежностей. Порядок: аргументи → запобіжник → підкоманда. Відмова аргументу чи запобіжника — код 2,
// до будь-якого виклику ssh, docker чи wrangler. Підкоманди підключаються по фазах; до того друкують `not implemented`.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseArgs } from './lib/args.mjs';
import { runBootstrap } from './lib/bootstrap.mjs';
import { runCapacity } from './lib/capacity/capacity.mjs';
import { SECRET_ENV_NAMES } from './lib/config.mjs';
import { runDeploy } from './lib/deploy.mjs';
import { realExec } from './lib/exec.mjs';
import { guardRun } from './lib/guard.mjs';
import { createOutput, redactorFromEnv } from './lib/redact.mjs';
import { runRollback } from './lib/rollback.mjs';
import { runEdgeSecret } from './lib/secrets.mjs';

const SUBCOMMANDS = ['deploy', 'rollback', 'bootstrap', 'edge-secret', 'move-domain', 'capacity'];
/** Змінні з `--secrets-file`, значення яких маскуються, навіть коли їх немає в `SECRET_ENV_NAMES`. */
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL)/i;

/**
 * @typedef {{
 *   args: import('./lib/args.mjs').ParsedArgs,
 *   env: Record<string, string | undefined>,
 *   exec: import('./lib/exec.mjs').Executor,
 *   redactor: import('./lib/redact.mjs').Redactor,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 *   now: () => Date,
 *   deps?: OpsDeps,
 * }} OpsContext
 * @typedef {import('./lib/deploy.mjs').OpsDeps & import('./lib/secrets.mjs').SecretsDeps & import('./lib/bootstrap.mjs').BootstrapDeps
 *   & import('./lib/capacity/capacity.mjs').CapacityDeps} OpsDeps
 */

/** Реалізовані підкоманди (додаються по фазах). @type {Record<string, (ctx: OpsContext) => Promise<number>>} */
const RUNNERS = { deploy: runDeploy, rollback: runRollback, 'edge-secret': runEdgeSecret, bootstrap: runBootstrap, capacity: runCapacity };

/**
 * @param {string[]} argv
 * @param {{
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 *   env?: Record<string, string | undefined>,
 *   exec?: import('./lib/exec.mjs').Executor,
 *   now?: () => Date,
 * } & OpsDeps} [deps] `exec`, `now`, `transport`, `worker`, `clock`, `git`, `image`,
 *   `stateRoot`, `startProbe`, `examplesDir`, `tunnelEnvFile`, `platform`, `edgeCheck`, `sshAs`, `capacity`,
 *   `realtimeComposeFile`, `fetch` — підставні в тестах
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  /** @type {Record<string, string | undefined>} */
  let env = deps.env ?? process.env;
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

  // `--secrets-file` (A6): змінні з файлу доповнюють середовище (наявні не перекриваються); значення секретів
  // одразу реєструються в редакторі. Файл не друкується, назва змінної — так.
  const secretsFile = args.values['secrets-file'];
  if (secretsFile !== undefined) {
    /** @type {Record<string, string | undefined>} */
    let parsed;
    try {
      parsed = parseEnv(fs.readFileSync(secretsFile, 'utf8'));
    } catch {
      err(`${sub}: не вдалося прочитати --secrets-file`);
      return 2;
    }
    env = { ...env };
    for (const [k, v] of Object.entries(parsed)) {
      if (env[k] === undefined && v !== undefined) env[k] = v;
      if (SECRET_ENV_NAMES.includes(k) || SECRET_NAME_RE.test(k)) redactor.add(v);
    }
  }

  const { out: _o, err: _e, env: _env, exec: _x, now: _n, ...opsDeps } = deps;
  return runner({ args, env, exec: deps.exec ?? realExec, redactor, out, err, now, deps: opsDeps });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
