// @ts-check
// Операції розгортання: `node infra/ops/ops.mjs <deploy|rollback|bootstrap|edge-secret|move-domain|capacity> …`.
// Нуль залежностей. Порядок: аргументи → запобіжник → підкоманда. Відмова аргументу чи запобіжника — код 2,
// до будь-якого виклику ssh, docker чи wrangler. Підкоманди підключаються по фазах; до того друкують `not implemented`.
//
// Це й корінь композиції: справжні адаптери (процеси, мережа, git, wrangler, провайдер потужності, годинник) і
// шляхи складаються тут один раз і йдуть у підкоманди як обов’язкові поля контексту (`ctx.deps`, `ctx.paths`,
// `ctx.platform`). Підкоманди не мають власних запасних «справжніх» реалізацій.
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseArgs } from './lib/args.mjs';
import { runBootstrap } from './lib/bootstrap.mjs';
import { runCapacity } from './lib/capacity/capacity.mjs';
import { loadProvider } from './lib/capacity/providers.mjs';
import { DEFAULT_PATHS, SECRET_ENV_NAMES } from './lib/config.mjs';
import { runDeploy } from './lib/deploy.mjs';
import { realExec } from './lib/exec.mjs';
import { createGit } from './lib/git.mjs';
import { guardRun } from './lib/guard.mjs';
import { createImage } from './lib/image.mjs';
import { runMoveDomain } from './lib/moveDomain.mjs';
import { SYSTEM_CLOCK } from './lib/node.mjs';
import { startProbe as realStartProbe } from './lib/probe.mjs';
import { createOutput, redactorFromEnv } from './lib/redact.mjs';
import { NODE_ENV_FILES } from './lib/secrets/files.mjs';
import { runRollback } from './lib/rollback.mjs';
import { fetchOk } from './lib/common.mjs';
import { runEdgeSecret } from './lib/secrets/secrets.mjs';
import { checkTarget } from './lib/target.mjs';
import { createWorker } from './lib/worker.mjs';

const SUBCOMMANDS = ['deploy', 'rollback', 'bootstrap', 'edge-secret', 'move-domain', 'capacity'];
/** Змінні з `--secrets-file`, значення яких маскуються, навіть коли їх немає в `SECRET_ENV_NAMES`. */
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL)/i;
/** Підкоманди, що працюють із вузлом середовища: значення секретів з його `.local/<env>/*.env` маскуються у виводі. */
const NODE_SECRET_SUBS = ['deploy', 'rollback', 'capacity'];

/** @param {string} name */
const isSecretName = (name) => SECRET_ENV_NAMES.includes(name) || SECRET_NAME_RE.test(name);

/**
 * Значення секретних змінних з локальних оригіналів файлів вузла (`<stateRoot>/<env>/{server,postgres,redis,cloudflared}.env`)
 * реєструються в редакторі: помилка міграції чи `docker`, що повторює рядок підключення, не виведе пароля. Файлів
 * немає — нічого не робить; нечитаний файл пропускається (його значень ops і не надсилає).
 * @param {import('./lib/redact.mjs').Redactor} redactor
 * @param {string} dir
 */
function registerLocalNodeSecrets(redactor, dir) {
  for (const name of NODE_ENV_FILES) {
    /** @type {string} */
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(text))) if (isSecretName(k)) redactor.add(v);
  }
}

/**
 * @typedef {import('./lib/exec.mjs').Executor} Executor
 * @typedef {import('./lib/exec.mjs').Transport} Transport
 * @typedef {import('./lib/config.mjs').OpsPaths} OpsPaths
 * @typedef {{ host: string, user: string, knownHostsFile: string, hostKeyAlias?: string }} SshTarget `hostKeyAlias` — ім’я,
 *   яке ввів оператор, коли `host` — уже перевірена адреса цього імені (`known_hosts` лишається за іменем)
 * @typedef {{
 *   clock: import('./lib/node.mjs').Clock,
 *   fetch: typeof globalThis.fetch,
 *   startProbe: (o: { url?: string, check?: () => Promise<boolean> }) => { stop: () => import('./lib/probe.mjs').ProbeResult },
 *   edgeCheck: (url: string) => Promise<boolean>,
 *   git: import('./lib/git.mjs').Git,
 *   image: () => import('./lib/image.mjs').Image,
 *   worker: (env: string) => import('./lib/worker.mjs').Worker,
 *   transport: (ssh: SshTarget | null) => Transport,
 *   sshAs: (o: SshTarget) => Transport,
 *   provider: () => Promise<import('./lib/capacity/provider.mjs').ProviderBundle>,
 *   lookupHost: (host: string) => Promise<string[]>,
 *   sshHostname: (host: string) => Promise<string>,
 * }} OpsPorts Порти підкоманд (усі обов’язкові). `edgeCheck` — одна перевірка `GET <url>` → 200; `transport(null)` —
 *   локальна ціль, інакше SSH зі звіркою ключа хоста; `sshAs` — перший вхід на новий вузол (`accept-new`);
 *   `provider` — набір провайдера потужності з `T2F_PROVIDER`; `lookupHost` — усі адреси імені (DNS);
 *   `sshHostname` — `hostname` з `ssh -G` (куди веде ціль з налаштуваннями користувача).
 * @typedef {{
 *   args: import('./lib/args.mjs').ParsedArgs,
 *   env: Record<string, string | undefined>,
 *   exec: Executor,
 *   redactor: import('./lib/redact.mjs').Redactor,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 *   now: () => Date,
 *   platform: NodeJS.Platform,
 *   paths: OpsPaths,
 *   deps: OpsPorts,
 * }} OpsContext
 * @typedef {Partial<OpsPorts> & {
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 *   env?: Record<string, string | undefined>,
 *   exec?: Executor,
 *   now?: () => Date,
 *   platform?: NodeJS.Platform,
 *   paths?: Partial<OpsPaths>,
 *   runners?: Record<string, (ctx: OpsContext) => Promise<number>>,
 * }} OpsOverrides Підміни для тестів.
 */

/** Реалізовані підкоманди (додаються по фазах). @type {Record<string, (ctx: OpsContext) => Promise<number>>} */
const RUNNERS = { deploy: runDeploy, rollback: runRollback, 'edge-secret': runEdgeSecret, bootstrap: runBootstrap, capacity: runCapacity, 'move-domain': runMoveDomain };

const PORT_KEYS = ['clock', 'fetch', 'startProbe', 'edgeCheck', 'git', 'image', 'worker', 'transport', 'sshAs', 'provider', 'lookupHost', 'sshHostname'];
const SSH_G_TIMEOUT_MS = 15_000;

/**
 * `hostname` з `ssh -G <host>`: куди ssh з налаштуваннями користувача справді з’єднався б.
 * @param {Executor} exec
 * @param {string} host
 */
async function sshConfigHostname(exec, host) {
  const r = await exec.run('ssh', ['-G', '--', host], { timeoutMs: SSH_G_TIMEOUT_MS });
  const m = r.code === 0 ? r.stdout.match(/^hostname\s+(\S+)\s*$/m) : null;
  if (!m) throw new Error('ssh -G не вдався');
  return m[1];
}
const OVERRIDE_KEYS = ['out', 'err', 'env', 'exec', 'now', 'platform', 'paths', 'runners', ...PORT_KEYS];
const PATH_KEYS = Object.keys(DEFAULT_PATHS);

/**
 * Невідома назва підміни — помилка одразу (описка в тесті не повинна тихо вести до справжніх адаптерів).
 * @param {OpsOverrides} o
 */
function assertKnownOverrides(o) {
  const bad = Object.keys(o).filter((k) => !OVERRIDE_KEYS.includes(k));
  const badPaths = Object.keys(o.paths ?? {}).filter((k) => !PATH_KEYS.includes(k));
  if (bad.length || badPaths.length) {
    throw new TypeError(`ops main: невідомі підміни: ${[...bad, ...badPaths.map((k) => `paths.${k}`)].join(', ')}`);
  }
}

/**
 * Порт, якого тест не підставив: будь-який виклик — помилка (а не справжня мережа, git чи wrangler).
 * @param {string} name
 * @returns {(...a: any[]) => never}
 */
const notInjected = (name) => () => {
  throw new Error(`ops: порт ${name} не підставлено`);
};

/**
 * Збирає порти. Без підмін (`main(argv)`) — справжні адаптери. З підмінами (тести) — те, що підставлено; порти,
 * похідні від `exec` (git, образ, Worker, транспорти), будуються на підставленому `exec`; решта, що виходить у
 * процеси, мережу чи до провайдера, без підміни кидає помилку.
 * @param {{ o: OpsOverrides, sandbox: boolean, env: Record<string, string | undefined>, out: (line: string) => void }} a
 * @returns {{ exec: Executor, deps: OpsPorts }}
 */
function composePorts({ o, sandbox, env, out }) {
  /** @type {Executor} */
  const exec =
    o.exec ??
    (sandbox
      ? { run: notInjected('exec'), start: notInjected('exec'), localTransport: notInjected('exec'), sshTransport: notInjected('exec') }
      : realExec);
  const doFetch = o.fetch ?? (sandbox ? notInjected('fetch') : globalThis.fetch);
  const clock = o.clock ?? (sandbox ? { now: notInjected('clock'), sleep: notInjected('clock') } : SYSTEM_CLOCK);
  const git = o.git ?? createGit({ exec, start: exec.start });
  return {
    exec,
    deps: {
      clock,
      fetch: doFetch,
      startProbe: o.startProbe ?? (sandbox ? notInjected('startProbe') : (p) => realStartProbe({ ...p, fetch: doFetch })),
      edgeCheck: o.edgeCheck ?? (sandbox ? notInjected('edgeCheck') : (url) => fetchOk(doFetch, url)),
      git,
      image: o.image ?? (() => createImage({ local: exec.localTransport(), git, start: exec.start })),
      worker: o.worker ?? ((workerEnv) => createWorker({ env: workerEnv, processEnv: env, run: exec.run, out })),
      transport: o.transport ?? ((ssh) => (ssh ? exec.sshTransport(ssh) : exec.localTransport())),
      sshAs:
        o.sshAs ??
        ((s) => {
          // Перший вхід — довіра до ключа хоста при першій зустрічі (accept-new) у `known_hosts`; далі ключ закріплений.
          const t = exec.sshTransport({ ...s, accept: 'new' });
          fs.mkdirSync(path.dirname(s.knownHostsFile), { recursive: true });
          return t;
        }),
      provider: o.provider ?? (() => loadProvider({ env, fetch: doFetch, clock })),
      lookupHost:
        o.lookupHost ??
        (sandbox ? notInjected('lookupHost') : async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address)),
      sshHostname: o.sshHostname ?? (sandbox ? notInjected('sshHostname') : (host) => sshConfigHostname(exec, host)),
    },
  };
}

/**
 * @param {string[]} argv
 * @param {OpsOverrides} [overrides] підміни для тестів; без них — справжні адаптери й типові шляхи
 * @returns {Promise<number>} exit code
 */
export async function main(argv, overrides) {
  const sandbox = overrides !== undefined;
  const o = overrides ?? {};
  assertKnownOverrides(o);
  /** @type {Record<string, string | undefined>} */
  let env = o.env ?? process.env;
  const redactor = redactorFromEnv(env);
  const { out, err } = createOutput(
    redactor,
    o.out ?? ((/** @type {string} */ line) => console.log(line)),
    o.err ?? o.out ?? ((/** @type {string} */ line) => console.error(line)),
  );
  const now = o.now ?? (() => new Date());

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
    action: args.action,
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

  const runner = (o.runners ?? RUNNERS)[sub];
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
      if (isSecretName(k)) redactor.add(v);
    }
  }

  const { exec, deps } = composePorts({ o, sandbox, env, out });
  /** @type {OpsPaths} */
  const paths = { ...DEFAULT_PATHS, ...o.paths };
  if (args.env !== undefined && NODE_SECRET_SUBS.includes(sub)) registerLocalNodeSecrets(redactor, path.join(paths.stateRoot, args.env));

  // AC-22 за адресою, а не написанням: ціль вузла (`--target`/`--host`) резолвиться до першого виклику SSH.
  const nodeTarget = args.values.target ?? args.values.host;
  if (nodeTarget !== undefined && nodeTarget !== 'local') {
    const checked = await checkTarget(nodeTarget, deps);
    if (!checked.ok) {
      err(`${sub}: ${checked.message}`);
      return checked.code;
    }
  }
  return runner({ args, env, exec, redactor, out, err, now, platform: o.platform ?? process.platform, paths, deps });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
