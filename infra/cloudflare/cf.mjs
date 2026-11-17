// @ts-check
// Інфраструктура Cloudflare за описом: `node cf.mjs plan|apply --env test`.
// Нуль залежностей. `plan` лише читає (GET). `apply` підключається в P8.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ApiRefusal, createApi } from './lib/api.mjs';
import { ENVS, PERMISSIONS, REQUIRED_ENV } from './lib/config.mjs';
import { readCurrent } from './lib/current.mjs';
import { desiredState } from './lib/desired.mjs';
import { diff } from './lib/diff.mjs';
import { createRedactor } from './lib/redact.mjs';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const o = {
    /** @type {string} */ command: 'plan',
    /** @type {string | undefined} */ env: undefined,
    /** @type {string | undefined} */ secretsFile: undefined,
    /** @type {boolean | undefined} */ underAttack: undefined,
    allowMainDomain: false,
    allowZoneSettings: false,
    allowDelete: false,
    /** @type {string[]} */ errors: [],
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('--')) o.command = String(rest.shift());
  while (rest.length) {
    const a = String(rest.shift());
    if (a === '--env') o.env = rest.shift();
    else if (a === '--secrets-file') o.secretsFile = rest.shift();
    else if (a === '--under-attack') {
      const v = rest.shift();
      if (v === 'on') o.underAttack = true;
      else if (v === 'off') o.underAttack = false;
      else o.errors.push('--under-attack приймає on або off');
    } else if (a === '--allow-main-domain') o.allowMainDomain = true;
    else if (a === '--allow-zone-settings') o.allowZoneSettings = true;
    else if (a === '--allow-delete') o.allowDelete = true;
    else o.errors.push(`невідомий аргумент: ${a}`);
  }
  return o;
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof globalThis.fetch, out?: (line: string) => void, now?: () => Date }} [deps]
 * @returns {Promise<number>} код виходу
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const redactor = createRedactor(env);
  const rawOut = deps.out ?? ((/** @type {string} */ l) => console.log(l));
  /** @param {string} line */
  const out = (line) => rawOut(redactor.mask(line));

  const args = parseArgs(argv);
  if (args.errors.length) {
    for (const e of args.errors) out(e);
    return 1;
  }
  if (args.command !== 'plan' && args.command !== 'apply') {
    out(`невідома команда: ${args.command} (plan | apply)`);
    return 1;
  }
  if (!args.env || !ENVS[args.env]) {
    out(`потрібен --env <${Object.keys(ENVS).join('|')}>`);
    return 1;
  }
  if (args.command === 'apply') {
    out('apply: not implemented');
    return 1;
  }

  if (args.secretsFile) {
    try {
      const parsed = parseEnv(readFileSync(args.secretsFile, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) if (env[k] === undefined && v !== undefined) env[k] = v;
    } catch {
      out(`не вдалося прочитати --secrets-file ${args.secretsFile}`);
      return 1;
    }
    for (const v of Object.values(redactorSources(env))) redactor.add(v);
  }

  const missing = REQUIRED_ENV.filter((n) => !env[n]);
  if (missing.length) {
    out(`бракує змінних: ${missing.join(', ')}`);
    out('Токен CLOUDFLARE_API_TOKEN_INFRA потребує дозволів:');
    for (const p of PERMISSIONS) out(`  - ${p}`);
    return 1;
  }

  try {
    const api = createApi({ env, fetch: deps.fetch });
    const desired = desiredState([args.env], { underAttack: args.underAttack });
    const current = await readCurrent(
      api,
      { accountId: String(env.CLOUDFLARE_ACCOUNT_ID), zoneId: String(env.CLOUDFLARE_ZONE_ID) },
      desired,
      redactor,
    );
    const changes = diff(desired, current);
    if (!changes.length) out('без змін');
    for (const c of changes) out(`${c.op.padEnd(6)} ${c.kind}: ${c.summary}`);
    return 0;
  } catch (e) {
    if (e instanceof ApiRefusal) {
      out(e.message);
      if (e.status === 401 || e.status === 403) {
        out(`категорія ${e.category}: перевірте дозволи токена:`);
        for (const p of PERMISSIONS) out(`  - ${p}`);
      }
    } else {
      out(e instanceof Error ? e.message : String(e));
    }
    return 1;
  }
}

/** @param {Record<string, string | undefined>} env */
function redactorSources(env) {
  return Object.fromEntries(
    ['CLOUDFLARE_API_TOKEN_INFRA', 'CLOUDFLARE_API_TOKEN', 'T2F_EDGE_SECRET', 'TUNNEL_TOKEN'].map((n) => [n, env[n]]),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
