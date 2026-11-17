// @ts-check
// Інфраструктура Cloudflare за описом: `node cf.mjs plan|apply --env test|rehearsal [--with-access]`.
// Нуль залежностей. `plan` лише читає (GET); `apply` змінює під замком `cloudflare` після запобіжника.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { OWNER_EMAILS_ENV, createAccessStep, desiredAccess, parseOwnerEmails } from './lib/access.mjs';
import { ApiRefusal, createApi } from './lib/api.mjs';
import { runApply, takeCloudflareLock } from './lib/apply.mjs';
import { ENVS, PERMISSIONS, REQUIRED_ENV } from './lib/config.mjs';
import { observe } from './lib/current.mjs';
import { desiredState, disabledAdminHosts } from './lib/desired.mjs';
import { diff } from './lib/diff.mjs';
import { describeRefusals, guard } from './lib/guard.mjs';
import { createRedactor } from './lib/redact.mjs';
import { accessMarkerExists } from './lib/tokenFile.mjs';

/** Тека для токенів тунелів (у .gitignore). */
const LOCAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.local');

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
    withAccess: false,
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
    else if (a === '--with-access') o.withAccess = true;
    else o.errors.push(`невідомий аргумент: ${a}`);
  }
  return o;
}

/**
 * @param {string[]} argv
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   out?: (line: string) => void,
 *   now?: () => Date,
 *   localDir?: string,
 *   desiredState?: typeof desiredState,
 *   acquireLock?: () => Promise<{ release: () => Promise<void> }>,
 * }} [deps] `localDir`, `desiredState`, `acquireLock` — лише для тестів
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

  // Access лише з --with-access: пошти — зі змінної (файл секретів), у вивід — лише кількість.
  /** @type {string[] | null} */
  let ownerEmails = null;
  if (args.withAccess) {
    ownerEmails = parseOwnerEmails(env[OWNER_EMAILS_ENV]);
    if (!ownerEmails) {
      out(`--with-access потребує ${OWNER_EMAILS_ENV} (пошти власника через кому) у середовищі або --secrets-file; у git їх немає`);
      return 1;
    }
    for (const e of ownerEmails) redactor.add(e);
    if (!ENVS[args.env]?.adminHost) {
      out(`--with-access: середовище ${args.env} не має імені адмінки (adminHost)`);
      return 1;
    }
    out(`Access: адрес власника — ${ownerEmails.length}`);
  }

  try {
    const api = createApi({ env, fetch: deps.fetch });
    // Завжди всі середовища: PUT фази замінює весь список, тож жодне середовище не випадає. --env обирає
    // файл токена тунелю, ціль --under-attack і застосунок Access.
    // Ім'я адмінки (ingress і CNAME) — лише з --with-access для цього середовища або коли позначка успішного кроку
    // Access уже є в .local; інакше його в бажаному стані немає, а залишок у Cloudflare йде в блок-правило (F2).
    const localDir = deps.localDir ?? LOCAL_DIR;
    const envNames = Object.keys(ENVS);
    /** @type {Record<string, boolean>} */
    const admin = Object.fromEntries(
      envNames.filter((n) => ENVS[n]?.adminHost).map((n) => [n, (args.withAccess && n === args.env) || accessMarkerExists(localDir, n)]),
    );
    /** @param {string[]} staleAdmin */
    const build = (staleAdmin) =>
      (deps.desiredState ?? desiredState)(envNames, { underAttack: { [String(args.env)]: args.underAttack }, admin, staleAdmin });
    const adminWatch = disabledAdminHosts(envNames, admin);
    const ids = { accountId: String(env.CLOUDFLARE_ACCOUNT_ID), zoneId: String(env.CLOUDFLARE_ZONE_ID) };
    const access = ownerEmails ? createAccessStep({ api, accountId: ids.accountId, app: desiredAccess(args.env, ownerEmails), out }) : undefined;
    const flags = { allowMainDomain: args.allowMainDomain, allowZoneSettings: args.allowZoneSettings, allowDelete: args.allowDelete };

    if (args.command === 'apply') {
      return await runApply({
        api,
        ids,
        envName: args.env,
        build,
        adminWatch,
        flags,
        redactor,
        out,
        now: deps.now ?? (() => new Date()),
        localDir,
        acquireLock: deps.acquireLock ?? (() => takeCloudflareLock(env)),
        access,
      });
    }

    const { desired, current, stale } = await observe({ api, ids, build, watch: adminWatch, redactor });
    for (const h of stale) out(`адмінка ${h}: є в Cloudflare без Access — apply прибере ingress і додасть ім'я в блок-правило`);
    const changes = diff(desired, current);
    if (access) changes.push(...(await access.changes()));
    if (current.zone.bot_fight_mode === null) out('Bot Fight Mode: стан не перевірено (токен без права Zone · Bot Management · Read)');
    if (!changes.length) out('без змін');
    for (const c of changes) out(`${c.op.padEnd(6)} ${c.kind}: ${c.summary}`);
    // Ті самі вердикти запобіжника, що й в apply; plan нічого не змінює, тож код 0.
    for (const line of describeRefusals(guard(changes, flags).refused)) out(line);
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
    ['CLOUDFLARE_API_TOKEN_INFRA', 'CLOUDFLARE_API_TOKEN', 'T2F_EDGE_SECRET', 'TUNNEL_TOKEN', 'T2F_OWNER_EMAILS'].map((n) => [n, env[n]]),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
