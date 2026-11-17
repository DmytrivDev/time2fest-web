// @ts-check
/**
 * Deploys the edge Worker to one environment (AC-13, NFR-3).
 *   node scripts/deploy.mjs --env <test|rehearsal|prelaunch|production> [--secrets-file <path>] [--confirm <env>] [--allow-main-domain]
 * Secrets travel only in the environment and the child's stdin, never in argv or output. Node built-ins only.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = path.resolve(PKG, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ENVS = ['test', 'rehearsal', 'prelaunch', 'production'];
/** Environments whose routes claim the main domain: they need `--allow-main-domain` as well. */
export const MAIN_DOMAIN_ENVS = ['prelaunch', 'production'];
const MIN_SECRET = 32;

/** @param {string[]} argv @param {string} name */
const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/**
 * Runs one wrangler child; resolves with its exit code. `input` goes to stdin.
 * @param {typeof nodeSpawn} spawn @param {string[]} args @param {NodeJS.ProcessEnv} env
 * @param {(s: string) => void} out @param {string} [input]
 * @returns {Promise<number>}
 */
function runChild(spawn, args, env, out, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER_JS, ...args], {
      shell: false,
      env,
      cwd: PKG,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => out(String(d)));
    child.stderr?.on('data', (d) => out(String(d)));
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
    if (input !== undefined) child.stdin?.write(input);
    child.stdin?.end();
  });
}

/**
 * @param {string[]} argv
 * @param {{
 *   spawn?: typeof nodeSpawn,
 *   env?: NodeJS.ProcessEnv,
 *   out?: (s: string) => void,
 *   err?: (s: string) => void,
 *   loadEnvFile?: (p: string) => void,
 *   assetsDir?: string,
 * }} [deps] `assetsDir` overrides the env's assets directory (tests).
 * @returns {Promise<number>} exit code
 */
export async function deploy(argv, deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const err = deps.err ?? ((s) => process.stderr.write(s));
  const target = flag(argv, '--env');
  const secretsFile = flag(argv, '--secrets-file');
  if (secretsFile) (deps.loadEnvFile ?? process.loadEnvFile.bind(process))(secretsFile);
  if (!target || !ENVS.includes(target)) {
    err(`unknown or missing --env (one of ${ENVS.join(', ')})\n`);
    return 1;
  }
  if (target !== 'test' && flag(argv, '--confirm') !== target) {
    err(`not deployed in this wave: ${target} needs --confirm ${target}\n`);
    return 2;
  }
  // prelaunch and production routes claim time2fest.com: a second, explicit flag (AC-21).
  if (MAIN_DOMAIN_ENVS.includes(target) && !argv.includes('--allow-main-domain')) {
    err(`refused: ${target} needs --confirm ${target} and --allow-main-domain\n`);
    return 2;
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(PKG, 'wrangler.json'), 'utf8'));
  const block = cfg.env[target];
  const proxy = Boolean(block.vars && 'ORIGIN_URL' in block.vars);
  const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', ...(proxy ? ['T2F_EDGE_SECRET'] : [])];
  const missing = required.filter((n) => !env[n]);
  const secret = env.T2F_EDGE_SECRET;
  if (proxy && secret && secret.length < MIN_SECRET) missing.push(`T2F_EDGE_SECRET (shorter than ${MIN_SECRET} characters)`);
  if (missing.length) {
    err(`missing: ${missing.join(', ')}\n`);
    return 1;
  }
  const assets = deps.assetsDir ?? path.resolve(PKG, block.assets.directory);
  if (!fs.existsSync(assets) || fs.readdirSync(assets).length === 0) {
    err(`assets directory is missing or empty: ${path.basename(assets)}\n`);
    return 1;
  }
  let code = await runChild(spawn, ['deploy', '--env', target], env, out);
  if (code !== 0) return code;
  if (proxy) {
    code = await runChild(spawn, ['secret', 'put', 'T2F_EDGE_SECRET', '--env', target], env, out, `${secret}\n`);
    if (code !== 0) return code;
  }
  out(`deployed ${target}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await deploy(process.argv.slice(2));
}
