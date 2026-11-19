// @ts-check
// Підготовка вузла realtime (AC-8, AC-49): SSH, кроки root (`deploy`, каталог), весь `bootstrap`, потім профіль
// Compose у каталог вузла — без запуску. Кожна частина спершу перевіряє «вже зроблено», тож повтор безпечний.
import { runBootstrap, ROOT_STEPS } from '../bootstrap.mjs';
import { DEPLOY_USER, knownHostsFile } from '../common.mjs';
import { checkTarget } from '../target.mjs';
import { REALTIME_COMPOSE_FILE, realtimeDir, server2Dir } from './plan.mjs';

const SSH_WAIT = { tries: 60, everyMs: 5_000 };
const REMOTE_TIMEOUT_MS = 60_000;

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('../node.mjs').Clock} Clock
 * @typedef {import('../exec.mjs').Transport} Transport
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 */

/**
 * @param {Transport} t
 * @param {string[]} argv
 * @param {{ input?: string, timeoutMs?: number }} [o]
 */
const remote = (t, argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? REMOTE_TIMEOUT_MS, ...(o.input !== undefined ? { input: o.input } : {}) });

/**
 * Підготовка вузла realtime: чекати SSH; від імені root — користувач `deploy` і каталог `/srv/t2f/<env>-realtime`
 * (кроки `ROOT_STEPS`); далі весь `bootstrap` (AC-8); потім `compose.realtime.yml` у каталог — без запуску.
 * Кожна частина спершу перевіряє «вже зроблено», тож повтор безпечний.
 * @param {OpsContext} ctx
 * @param {Node} node
 * @param {string} composeText
 * @param {Clock} clock
 */
export async function prepareRealtime(ctx, node, composeText, clock) {
  const env = /** @type {string} */ (ctx.args.env);
  const dir = realtimeDir(env);
  const { asDeploy } = await bootstrapNode(ctx, node, dir, clock);
  const upload = ['sh', '-c', `set -e; umask 077; cat > "$1/${REALTIME_COMPOSE_FILE}.tmp"; mv "$1/${REALTIME_COMPOSE_FILE}.tmp" "$1/${REALTIME_COMPOSE_FILE}"`, '_', dir];
  const r = await remote(asDeploy, upload, { input: composeText });
  if (r.code !== 0) throw new Error(`${REALTIME_COMPOSE_FILE} у ${dir}: не записано (код ${r.code})`);
  ctx.out(`capacity: ${REALTIME_COMPOSE_FILE} записано в ${dir} (не запущено: токен тунелю realtime — П-RT)`);
}

// --- O·P18a: підготовка другого вузла сервера ---
/**
 * Те саме, що для realtime (SSH, `deploy`, каталог, весь `bootstrap`: Docker, ufw лише 22/tcp, підкачка), але каталог
 * `/srv/t2f/<env>-server2` і без Compose-файлу: його й образ привозить `ops server2 up`. Нічого не запускає.
 * @param {OpsContext} ctx
 * @param {Node} node
 * @param {Clock} clock
 */
export async function prepareServer2(ctx, node, clock) {
  const env = /** @type {string} */ (ctx.args.env);
  const dir = server2Dir(env);
  await bootstrapNode(ctx, node, dir, clock);
  ctx.out(`capacity: ${node.name} підготовлено, каталог ${dir} (сервер не запущено — ops server2 --env ${env} up)`);
}
// --- кінець O·P18a ---

/**
 * Спільне: чекати SSH; від імені root — `deploy` і каталог (кроки `ROOT_STEPS`); далі весь `bootstrap`.
 * @param {OpsContext} ctx
 * @param {Node} node
 * @param {string} dir
 * @param {Clock} clock
 * @returns {Promise<{ asDeploy: Transport }>}
 */
async function bootstrapNode(ctx, node, dir, clock) {
  const env = /** @type {string} */ (ctx.args.env);
  const ip = node.publicIp;
  if (!ip) throw new Error(`у вузла ${node.name} немає публічної адреси`);
  // Адреса від провайдера — та сама звірка зі старою продакшн-адресою, що й `--target`, до першого SSH (AC-22).
  const checked = await checkTarget(ip, ctx.deps);
  if (!checked.ok) throw new Error(`вузол ${node.name}: ${checked.message}`);
  // З’єднання — саме з перевіреною адресою (ціль тут уже адреса, тож HostKeyAlias не потрібен).
  const host = checked.address;
  if (!host) throw new Error(`вузол ${node.name}: публічна адреса не IPv4`);
  const knownHosts = knownHostsFile(ctx);
  const asRoot = ctx.deps.sshAs({ host, user: 'root', knownHostsFile: knownHosts });
  const asDeploy = ctx.deps.sshAs({ host, user: DEPLOY_USER, knownHostsFile: knownHosts });

  /** @type {'root' | 'deploy' | null} */
  let who = null;
  for (let i = 0; i < SSH_WAIT.tries && !who; i++) {
    if ((await remote(asRoot, ['true'])).code === 0) who = 'root';
    else if ((await remote(asDeploy, ['true'])).code === 0) who = 'deploy';
    else await clock.sleep(SSH_WAIT.everyMs);
  }
  if (!who) throw new Error(`вузол ${node.name} не приймає SSH`);

  if (who === 'root') {
    for (const id of ['deploy-user', 'node-dir']) {
      const s = ROOT_STEPS.find((x) => x.id === id);
      if (!s?.apply) throw new Error(`немає кроку bootstrap ${id}`);
      if ((await remote(asRoot, s.check(dir))).code === 0) continue;
      const r = await remote(asRoot, s.apply(dir), { input: s.input, timeoutMs: s.timeoutMs });
      if (r.code !== 0 || (await remote(asRoot, s.check(dir))).code !== 0) throw new Error(`${id} (${s.title}) для ${dir}: не вдалося (код ${r.code})`);
    }
  }

  const code = await runBootstrap({ ...ctx, args: { sub: 'bootstrap', env, values: { host }, flags: {} } });
  if (code !== 0) throw new Error(`bootstrap вузла ${node.name} завершився з кодом ${code}`);
  return { asDeploy };
}
