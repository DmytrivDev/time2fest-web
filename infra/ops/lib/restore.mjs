// @ts-check
// `ops restore --env <env> --from <ключ|штамп|latest> --target local [--host <вузол джерела>] [--image <sha>]
//   [--keep] [--no-record]` (SPEC-13b W44, [П-7]; AC-53 … AC-57, AC-59).
// Копія середовища-джерела → ЧИСТИЙ локальний стек: власний проєкт Compose `t2f-restore-<UTC-штамп>`
// (`infra/ops/node/compose.restore.yml`), створений цим запуском; `-p t2f` і чужі томи не чіпаються ніколи.
// Порядок: відмови (production, ціль, файл змінних джерела, проєкт не порожній) — до будь-якого завантаження (AC-54) →
// образ-читач → маніфест (`ops restore-pull --manifest-only` у разовому контейнері) → образ коміту маніфесту →
// postgres/redis → `ops restore-pull` (завантаження в теку цілі, sha256 і id ключа ДО `pg_restore`, розшифрування
// потоком; AC-55, AC-59) → сервер коміту → перевірки (міграції, здоров’я, кількість рядків = маніфест, каталог; AC-57) →
// звіт (тривалість, вікно втрати) → `ops restore-record` на вузлі джерела (AC-56). Тека тимчасових файлів
// прибирається в `finally` і на SIGINT/SIGTERM; стек — `down -v` саме цього проєкту (крім `--keep`).
// Один формат `T2FB1` і один клієнт S3 — у сервері: тут жодної криптографії й жодного SigV4 (нуль залежностей).
// Ключі R2 і ключ копії йдуть у разовий контейнер лише середовищем процесу (`-e NAME` без значення), не argv.
// Коди: 0 — відновлено й перевірено; 2 — відмова до завантаження; 1 — збій кроку чи перевірки.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { DEPLOY_USER, knownHostsFile, messageOf } from './common.mjs';
import { ENVS, REPO_ROOT } from './config.mjs';
import { guardRun } from './guard.mjs';
import { imageTag } from './image.mjs';
import { createNode, CURRENT_ENV } from './node.mjs';
import { lastJsonLine } from './backup.mjs';
import { checkTarget } from './target.mjs';

export const RESTORE_COMPOSE_PATH = 'infra/ops/node/compose.restore.yml';
export const PROJECT_PREFIX = 't2f-restore-';
const RE_PROJECT = /^t2f-restore-\d{8}t\d{6}z$/;
const RE_SHA40 = /^[0-9a-f]{40}$/;
const RE_TABLE = /^[a-z_][a-z0-9_]{0,62}$/;
const DAY_MS = 86_400_000;
/** Змінні джерела, потрібні `restore-pull` (лише назви друкуються). */
export const SOURCE_VARS = /** @type {const} */ (['T2F_R2_ENDPOINT', 'T2F_R2_BUCKET', 'T2F_R2_ACCESS_KEY_ID', 'T2F_R2_SECRET_ACCESS_KEY', 'T2F_R2_PREFIX', 'T2F_BACKUP_KEY']);
/** Їхні значення маскуються у виводі (кінцева точка, бакет і префікс — не секрети). */
const SECRET_SOURCE_VARS = /** @type {const} */ (['T2F_R2_ACCESS_KEY_ID', 'T2F_R2_SECRET_ACCESS_KEY', 'T2F_BACKUP_KEY']);
const SHORT_MS = 60_000;
const UP_MS = 5 * 60_000;
const PULL_MS = 60 * 60_000;

/**
 * Вікно втрати (AC-57, [А16]): найбільший проміжок між знімками сусідніх успішних копій за 24 год до `endMs`
 * (момент копії, що відновлюється). Менше двох знімків — `null` («одна копія»). Та сама формула, що й
 * `server/src/domain/ops/lossWindow.ts`.
 * @param {readonly string[]} snapshots ISO-моменти
 * @param {number} endMs
 * @returns {number | null}
 */
export function lossWindowMs(snapshots, endMs) {
  const times = snapshots
    .map((s) => Date.parse(s))
    .filter((t) => Number.isFinite(t) && t <= endMs && t >= endMs - DAY_MS)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  let gap = 0;
  for (let i = 1; i < times.length; i += 1) gap = Math.max(gap, times[i] - times[i - 1]);
  return gap;
}

/**
 * Назви непройдених міграцій з виводу `payload migrate:status` (таблиця `Name | Batch | Ran`): рядок, остання
 * непорожня клітинка якого — `No`.
 * @param {string} text
 * @returns {{ pending: string[], applied: string[] }}
 */
export function migrationStatus(text) {
  /** @type {string[]} */
  const pending = [];
  /** @type {string[]} */
  const applied = [];
  for (const line of String(text).split(/\r?\n/)) {
    const cells = line.split(/[|│┃]/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const ran = cells[cells.length - 1];
    if (ran === 'No') pending.push(cells[0]);
    else if (ran === 'Yes') applied.push(cells[0]);
  }
  return { pending, applied };
}

/**
 * SQL лічильників ключових таблиць маніфесту; назва, що не схожа на таблицю, — відмова (у SQL не потрапить).
 * @param {Record<string, unknown>} rowCounts
 */
export function rowCountSql(rowCounts) {
  const tables = Object.keys(rowCounts).sort();
  if (!tables.length) throw new Error('у маніфесті немає кількостей рядків');
  for (const t of tables) if (!RE_TABLE.test(t)) throw new Error('маніфест: недопустима назва таблиці');
  return tables.map((t) => `SELECT '${t}', count(*) FROM "${t}"`).join(' UNION ALL ');
}

/**
 * Розбіжності кількостей рядків (`psql -tA -F ,`: рядок `таблиця,кількість`).
 * @param {string} stdout
 * @param {Record<string, unknown>} expected
 * @returns {string[]} `таблиця: маніфест N, ціль M`
 */
export function rowCountMismatches(stdout, expected) {
  /** @type {Record<string, number>} */
  const got = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = line.trim().match(/^([a-z_][a-z0-9_]*),(\d+)$/);
    if (m) got[m[1]] = Number(m[2]);
  }
  return Object.keys(expected)
    .sort()
    .filter((t) => got[t] !== expected[t])
    .map((t) => `${t}: маніфест ${String(expected[t])}, ціль ${got[t] ?? '—'}`);
}

/** Назва проєкту Compose цього запуску. @param {Date} now */
export function projectNameOf(now) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').toLowerCase();
  return `${PROJECT_PREFIX}${stamp}`;
}

/** @param {number | null} ms */
const minutes = (ms) => (ms === null ? 'n/a — одна копія за 24 год' : `${Math.round(ms / 60_000)} хв`);

/**
 * `ops restore`.
 * @param {import('../ops.mjs').OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runRestore(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const from = /** @type {string} */ (ctx.args.values.from);
  const host = ctx.args.values.host;
  const keep = ctx.args.flags.keep === true;
  const noRecord = ctx.args.flags['no-record'] === true;
  /** @param {string} m */
  const refuse = (m) => {
    err(`restore: ${m}`);
    return 2;
  };

  // 1. Відмови до будь-якого виклику (AC-54).
  if (env === 'production' || ENVS[env]?.freeze === true) return refuse('production не відновлюється цією командою (ні як джерело, ні як ціль)');
  if (!ENVS[env]?.serverSteps) return refuse(`у середовища ${env} немає бази — відновлювати нічого`);
  if (ctx.args.values.target !== 'local') return refuse('ціль — лише local');
  if (host !== undefined && noRecord) return refuse('--host і --no-record разом не мають сенсу');
  if (host !== undefined) {
    const g = guardRun({ sub: 'restore', env, target: host, flags: {}, now: ctx.now() });
    if (!g.ok) return refuse(g.message);
    const checked = await checkTarget(host, ctx.deps);
    if (!checked.ok) return refuse(checked.message);
  }

  /** @type {Record<string, string>} */
  const source = {};
  const envFile = path.join(ctx.paths.stateRoot, env, 'server.env');
  try {
    const parsed = parseEnv(fs.readFileSync(envFile, 'utf8'));
    for (const n of SOURCE_VARS) if (parsed[n]) source[n] = String(parsed[n]);
  } catch {
    return refuse(`немає файлу змінних джерела .local/${env}/server.env`);
  }
  for (const n of SECRET_SOURCE_VARS) if (source[n]) ctx.redactor.add(source[n]);
  const missing = SOURCE_VARS.filter((n) => !source[n]);
  if (missing.length) return refuse(`у .local/${env}/server.env бракує: ${missing.join(', ')}`);
  if (/prod/i.test(source.T2F_R2_BUCKET) || /prod/i.test(source.T2F_R2_PREFIX)) return refuse('бакет чи префікс джерела схожий на production — відмова');

  const local = ctx.deps.transport(null);
  const project = projectNameOf(ctx.now());
  if (!RE_PROJECT.test(project)) return refuse('недопустима назва проєкту відновлення');
  const runDir = path.join(ctx.paths.stateRoot, 'restore', project);
  const tmpDir = path.join(runDir, 'tmp');
  const composeFile = path.join(REPO_ROOT, RESTORE_COMPOSE_PATH);

  // Чистота цілі: у проєкту цього запуску немає ні контейнерів, ні томів (AC-54, EC-19).
  for (const what of [['volume', 'ls', '-q'], ['ps', '-aq']]) {
    const r = await local.exec(['docker', ...what, '--filter', `label=com.docker.compose.project=${project}`], { timeoutMs: SHORT_MS });
    if (r.code !== 0) return refuse(`docker ${what[0]}: код ${r.code}`);
    if (r.stdout.trim() !== '') return refuse(`ціль не чиста: проєкт ${project} уже має ${what[0] === 'volume' ? 'томи' : 'контейнери'}`);
  }

  const clock = ctx.deps.clock;
  const t0 = clock.now();
  /** Змінні процесу `docker compose`: інтерполяція й `-e NAME` разового `pull`. Секрети — лише тут. */
  const pgPassword = crypto.randomBytes(24).toString('base64url');
  const payloadSecret = crypto.randomBytes(32).toString('base64url');
  ctx.redactor.add(pgPassword);
  ctx.redactor.add(payloadSecret);
  /** @type {NodeJS.ProcessEnv} */
  const composeEnv = {
    ...process.env,
    T2F_RESTORE_PG_PASSWORD: pgPassword,
    T2F_RESTORE_PAYLOAD_SECRET: payloadSecret,
    T2F_RESTORE_TMP_HOST: tmpDir,
    T2F_SERVER_SHA: '',
  };
  /** @param {string[]} args */
  const compose = (args) => ['docker', 'compose', '-p', project, '-f', composeFile, ...args];
  /** @param {string[]} argv @param {number} timeoutMs @param {NodeJS.ProcessEnv} [extra] */
  const run = (argv, timeoutMs, extra = {}) => local.exec(argv, { timeoutMs, env: { ...composeEnv, ...extra } });

  let created = false;
  const cleanupTemp = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort; reported below */
    }
  };
  const onSignal = () => {
    cleanupTemp();
    err(`restore: перервано; тимчасові файли прибрано; стек лишився: docker compose -p ${project} -f ${composeFile} down -v`);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  /** @type {'ok' | 'failed'} */
  let result = 'failed';
  let pulled = false;
  /** @type {Record<string, any> | null} */
  let manifest = null;
  /** @type {number | null} */
  let loss = null;
  try {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const image = ctx.deps.image();

    // 2. Образ-читач (будь-який образ із `restore-pull`): `--image` або HEAD.
    const reader = await ctx.deps.git.resolveCommit(ctx.args.values.image);
    if (reader.code !== 0) return refuse(reader.message);
    const built = await image.buildImage(reader.sha);
    if (built.code !== 0) {
      err(`restore: образ ${imageTag(reader.sha)} не зібрано: ${'message' in built ? built.message : ''}`);
      return 1;
    }

    // 3. Маніфест (лише читання R2).
    const pullEnv = Object.fromEntries(SOURCE_VARS.map((n) => [n, source[n]]));
    const eFlags = SOURCE_VARS.flatMap((n) => ['-e', n]);
    const m = await run(
      ['docker', 'run', '--rm', ...eFlags, '-e', 'T2F_ENV=test', imageTag(reader.sha), 'pnpm', 'run', 'ops', 'restore-pull', '--manifest-only', '--key', from],
      SHORT_MS * 5,
      pullEnv,
    );
    const mAnswer = lastJsonLine(m.stdout);
    if (m.code !== 0 || mAnswer?.ok !== true || !mAnswer.manifest || typeof mAnswer.manifest !== 'object') {
      err(`restore: маніфест копії ${from} не прочитано (код ${m.code})`);
      for (const line of String(m.stderr).split(/\r?\n/).filter((l) => l.trim()).slice(-5)) err(`  ${line}`);
      return m.code === 2 ? 2 : 1;
    }
    manifest = /** @type {Record<string, any>} */ (mAnswer.manifest);
    const snapshots = Array.isArray(mAnswer.snapshots) ? mAnswer.snapshots.map(String) : [];
    const snapshotAt = Date.parse(String(manifest.snapshotAt));
    loss = lossWindowMs(snapshots, Number.isFinite(snapshotAt) ? snapshotAt : ctx.now().getTime());
    const rowSql = rowCountSql(manifest.rowCounts ?? {});
    out(`restore: копія ${manifest.key}: ${manifest.size} байт, знімок ${manifest.snapshotAt}, коміт ${manifest.commit ?? '—'}`);

    // 4. Образ коміту маніфесту (міграції й код тієї самої версії).
    let sha = reader.sha;
    if (typeof manifest.commit === 'string' && RE_SHA40.test(manifest.commit)) sha = manifest.commit;
    else err(`restore: у маніфесті немає коміту — сервер з образу ${sha.slice(0, 12)}`);
    if (sha !== reader.sha) {
      const b = await image.buildImage(sha);
      if (b.code !== 0) {
        err(`restore: образ ${imageTag(sha)} не зібрано: ${'message' in b ? b.message : ''}`);
        return 1;
      }
    }
    composeEnv.T2F_SERVER_SHA = sha;

    // 5. Чисті postgres і redis.
    created = true;
    const up = await run(compose(['up', '-d', '--wait', 'postgres', 'redis']), UP_MS);
    if (up.code !== 0) return fail(`postgres/redis не піднялися (код ${up.code})`);

    // 6. Завантаження, перевірка, розшифрування потоком у pg_restore (у разовому контейнері).
    pulled = true;
    const p = await run(compose(['--profile', 'pull', 'run', '--rm', '--no-deps', ...eFlags, 'pull', 'pnpm', 'run', 'ops', 'restore-pull', '--key', String(manifest.key)]), PULL_MS, pullEnv);
    if (p.code !== 0) {
      for (const line of String(p.stderr).split(/\r?\n/).filter((l) => l.trim()).slice(-5)) err(`  ${line}`);
      if (p.code === 3) return fail('перевірка копії не пройшла (sha256, id ключа чи автентифікація) — pg_restore не запускався');
      return fail(`restore-pull завершився з кодом ${p.code}`);
    }

    // 7. Сервер коміту на відновленій базі й перевірки (AC-57).
    const s = await run(compose(['up', '-d', '--wait', 'server']), UP_MS);
    if (s.code !== 0) return fail(`сервер не став здоровим (код ${s.code})`);
    const health = await run(compose(['exec', '-T', 'server', 'node', 'scripts/health-probe.mjs']), SHORT_MS);
    if (health.code !== 0 || !health.stdout.split(/\r?\n/).some((l) => l.trim().startsWith('200 '))) return fail('/api/health не 200');
    const st = await run(compose(['exec', '-T', 'server', 'pnpm', 'migrate:status']), UP_MS);
    const mig = migrationStatus(st.stdout);
    if (st.code !== 0) return fail(`migrate:status завершився з кодом ${st.code}`);
    if (mig.pending.length) return fail(`непройдені міграції: ${mig.pending.join(', ')}`);
    if (manifest.lastMigration && !mig.applied.includes(String(manifest.lastMigration))) return fail(`остання міграція маніфесту ${manifest.lastMigration} не застосована`);
    const counts = await run(compose(['exec', '-T', 'postgres', 'psql', '-U', 't2f', '-d', 't2f_restore', '-tA', '-F', ',', '-c', rowSql]), SHORT_MS);
    if (counts.code !== 0) return fail(`лічильники рядків не прочитано (код ${counts.code})`);
    const mismatches = rowCountMismatches(counts.stdout, manifest.rowCounts);
    if (mismatches.length) return fail(`кількість рядків не збігається з маніфестом: ${mismatches.join('; ')}`);
    const status = await run(compose(['exec', '-T', 'server', 'pnpm', 'run', 'ops', 'status']), SHORT_MS * 2);
    const overview = lastJsonLine(status.stdout);
    const catalog = /** @type {any} */ (overview)?.blocks?.catalog;
    if (status.code !== 0 || !catalog || !catalog.seasonKey) return fail('версії каталогу у відновленій базі немає');

    result = 'ok';
    out(`restore: готово за ${Math.round((clock.now() - t0) / 1000)} с; вікно втрати ${minutes(loss)}; міграції: 0 непройдених; рядки = маніфест; каталог ${catalog.seasonKey}`);
    return 0;
  } catch (e) {
    return fail(messageOf(e));
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanupTemp();
    if (fs.existsSync(tmpDir)) err(`restore: тимчасову теку ${tmpDir} не прибрано — видаліть вручну`);
    if (pulled && manifest) await record(result);
    if (created) {
      if (keep) out(`restore: стек лишено (--keep); прибрати: docker compose -p ${project} -f ${composeFile} down -v`);
      else if (RE_PROJECT.test(project)) {
        const d = await run(compose(['down', '-v', '--remove-orphans']), UP_MS).catch(() => ({ code: 1 }));
        if (d.code !== 0) err(`restore: стек ${project} не прибрано (код ${d.code}); docker compose -p ${project} -f ${composeFile} down -v`);
      }
    }
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch {
      /* порожня тека запуску — не важливо */
    }
  }

  /** @param {string} m */
  function fail(m) {
    err(`restore: ${m}`);
    return 1;
  }

  /** Запис заміру в середовище джерела (AC-56). @param {'ok' | 'failed'} res */
  async function record(res) {
    const m = /** @type {Record<string, any>} */ (manifest);
    const durationMs = Math.max(0, Math.round(clock.now() - t0));
    const args = ['restore-record', '--at', ctx.now().toISOString(), '--key', String(m.key), '--duration-ms', String(durationMs), ...(loss !== null ? ['--loss-ms', String(loss)] : []), '--result', res, '--target', 'local'];
    if (noRecord) return;
    if (host === undefined) {
      out(`restore: замір не записано (немає --host); на вузлі джерела: pnpm run ops ${args.join(' ')}`);
      return;
    }
    try {
      const cfg = ENVS[env];
      const t = ctx.deps.transport({ host, user: DEPLOY_USER, knownHostsFile: knownHostsFile(ctx) });
      const node = createNode({ transport: t, env, project: /** @type {string} */ (cfg.project), nodeDir: /** @type {string} */ (cfg.nodeDir), clock });
      const r = await t.exec(node.argv(CURRENT_ENV, ['exec', '-T', 'server', 'pnpm', 'run', 'ops', ...args]), { timeoutMs: SHORT_MS });
      if (r.code === 0) out(`restore: замір записано на ${t.describe}`);
      else err(`restore: замір не записано (код ${r.code}); на вузлі джерела: pnpm run ops ${args.join(' ')}`);
    } catch (e) {
      err(`restore: замір не записано: ${messageOf(e)}`);
    }
  }
}
