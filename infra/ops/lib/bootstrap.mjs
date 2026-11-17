// @ts-check
// Підготовка вузла (AC-8, EC-9): користувач `deploy` з ключем власника, Docker з архіву Ubuntu, каталог вузла,
// брандмауер (вхідний лише TCP 22), підкачка 2 GB, потім — лише після перевірки входу `deploy` — вимкнення входу root і паролів.
// Кожен крок спершу перевіряє «вже зроблено» без змін; повторний запуск нічого не змінює.
// Віддалені команди — фіксовані рядки; єдине значення ззовні — каталог вузла з `ENVS` (позиційний `$1`).
// Коди: 0 — готово або без змін; 2 — відмова до будь-якої зміни; 1 — крок не вдався.
import { ENVS } from './config.mjs';
import { DEPLOY_USER, knownHostsFile, messageOf } from './common.mjs';
import { checkTarget } from './target.mjs';

const REMOTE_TIMEOUT_MS = 60_000;
const APT_TIMEOUT_MS = 15 * 60_000;
/** Код ssh, коли не вдалося під’єднатися чи увійти (не код віддаленої команди). */
export const SSH_FAILED = 255;
export const SSHD_DROP_IN = '/etc/ssh/sshd_config.d/00-t2f.conf';
/** `00-` — раніше за `50-cloud-init.conf`: sshd бере перше значення, тож наші рядки виграють. */
export const SSHD_CONF = 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n';
/** Файл підкачки (рішення власника 2026-11-17: вузол 1 vCPU / 2 GB) і drop-in `vm.swappiness`. */
export const SWAP_FILE = '/swapfile';
export const SWAP_SIZE_MB = 2048;
export const SWAPPINESS = 10;
export const SWAP_SYSCTL = '/etc/sysctl.d/99-t2f-swap.conf';
export const ROOT_ONLY_NOTE = 'перевірено при першому запуску; повторна перевірка — порт-скан R4';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./exec.mjs').RunResult} RunResult
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {{
 *   id: string,
 *   title: string,
 *   check: (nodeDir: string) => string[],
 *   ok?: (r: RunResult) => boolean,
 *   apply?: (nodeDir: string) => string[],
 *   input?: string,
 *   timeoutMs?: number,
 * }} Step
 */

/** @param {string} script @returns {(nodeDir: string) => string[]} */
const sh = (script) => (nodeDir) => ['sh', '-c', script, '_', nodeDir];

/**
 * Брандмауер у стані AC-8: увімкнений, вхідні за замовчуванням заборонені, вихідні дозволені, дозволений вхідний
 * лише `22/tcp` з обмеженням частоти (`ufw limit`, IPv4 і IPv6). Правило `ALLOW` для 22 (давніший bootstrap) — не
 * готово: крок застосовується знову, і `ufw limit 22/tcp` оновлює правило.
 * @param {string} stdout вивід `ufw status verbose`
 */
export function ufwOk(stdout) {
  const s = String(stdout);
  if (!/^Status: active\s*$/m.test(s)) return false;
  if (!/^Default: deny \(incoming\), allow \(outgoing\)/m.test(s)) return false;
  const inbound = s.split(/\r?\n/).filter((l) => /\b(?:ALLOW|LIMIT) IN\b/.test(l));
  return inbound.length > 0 && inbound.every((l) => /^22\/tcp(?:\s+\(v6\))?\s+LIMIT IN\b/.test(l.trim()));
}

/** Кроки від імені root, по порядку. Крок `deploy-login` — окремо (перевірка без змін, із другим входом). @type {Step[]} */
export const ROOT_STEPS = [
  {
    id: 'deploy-user',
    title: 'користувач deploy з ключем власника',
    check: sh('id -u deploy >/dev/null 2>&1 && test -s ~deploy/.ssh/authorized_keys'),
    apply: sh(
      'set -e; id -u deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy; ' +
        'install -d -m 700 -o deploy -g deploy ~deploy/.ssh; ' +
        'install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys ~deploy/.ssh/authorized_keys',
    ),
  },
  {
    id: 'docker',
    title: 'Docker з архіву Ubuntu',
    check: sh('docker --version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && id -nG deploy | tr " " "\\n" | grep -qx docker'),
    apply: sh(
      'set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y docker.io docker-compose-v2; ' +
        'usermod -aG docker deploy',
    ),
    timeoutMs: APT_TIMEOUT_MS,
  },
  {
    id: 'node-dir',
    title: 'каталог вузла (deploy, 700)',
    check: sh('test -d "$1" && test "$(stat -c %U:%a "$1")" = deploy:700'),
    apply: sh('install -d -m 700 -o deploy -g deploy "$1"'),
  },
  {
    id: 'firewall',
    title: 'брандмауер: вхідний лише TCP 22 (limit)',
    check: () => ['ufw', 'status', 'verbose'],
    ok: (r) => r.code === 0 && ufwOk(r.stdout),
    apply: sh(
      'set -e; command -v ufw >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y ufw; ' +
        'ufw default deny incoming; ufw default allow outgoing; ufw limit 22/tcp; ufw --force enable',
    ),
    timeoutMs: APT_TIMEOUT_MS,
  },
  {
    id: 'swap',
    title: `підкачка ${SWAP_FILE} ${SWAP_SIZE_MB / 1024} GB, vm.swappiness=${SWAPPINESS}`,
    check: sh(
      `swapon --show=NAME --noheadings | grep -qx ${SWAP_FILE} && grep -q "^${SWAP_FILE} " /etc/fstab && ` +
        `test -f ${SWAP_SYSCTL} && test "$(cat /proc/sys/vm/swappiness)" = ${SWAPPINESS}`,
    ),
    apply: sh(
      'set -e; ' +
        `if ! swapon --show=NAME --noheadings | grep -qx ${SWAP_FILE}; then ` +
        `rm -f ${SWAP_FILE}; fallocate -l ${SWAP_SIZE_MB}M ${SWAP_FILE} || { rm -f ${SWAP_FILE}; dd if=/dev/zero of=${SWAP_FILE} bs=1M count=${SWAP_SIZE_MB} status=none; }; ` +
        `chown root:root ${SWAP_FILE}; chmod 600 ${SWAP_FILE}; mkswap ${SWAP_FILE} >/dev/null; swapon ${SWAP_FILE}; fi; ` +
        `grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab; ` +
        `echo "vm.swappiness=${SWAPPINESS}" > ${SWAP_SYSCTL}; sysctl -q -p ${SWAP_SYSCTL}`,
    ),
  },
  {
    id: 'sshd',
    title: 'SSH: без входу root і паролів',
    check: sh(
      `test -f ${SSHD_DROP_IN} && c="$(sshd -T)" && printf "%s\\n" "$c" | grep -qx "permitrootlogin no" && ` +
        'printf "%s\\n" "$c" | grep -qx "passwordauthentication no" && printf "%s\\n" "$c" | grep -qx "kbdinteractiveauthentication no"',
    ),
    apply: sh(
      `set -e; umask 022; cat > ${SSHD_DROP_IN}.tmp; mv ${SSHD_DROP_IN}.tmp ${SSHD_DROP_IN}; ` +
        `sshd -t || { rm -f ${SSHD_DROP_IN}; exit 1; }; systemctl reload ssh`,
    ),
    input: SSHD_CONF,
  },
];

/** Перевірка входу `deploy` тим самим ключем: стоїть безпосередньо перед `sshd`. */
export const LOGIN_STEP_ID = 'deploy-login';
/** Перевірки повторного запуску від імені `deploy` (root уже не входить). @type {Step[]} */
export const DEPLOY_CHECKS = [
  { id: 'docker', title: 'docker info від імені deploy', check: () => ['docker', 'info', '--format', '{{.ServerVersion}}'] },
  { id: 'node-dir', title: 'каталог вузла доступний deploy', check: sh('test -d "$1" && test -w "$1"') },
];

/**
 * @param {Transport} t
 * @param {string[]} argv
 * @param {{ input?: string, timeoutMs?: number }} [o]
 */
const remote = (t, argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? REMOTE_TIMEOUT_MS, ...(o.input !== undefined ? { input: o.input } : {}) });

/**
 * `ops bootstrap --host <ipv4|name> [--env rehearsal]`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runBootstrap(ctx) {
  const { out, err } = ctx;
  const env = ctx.args.env ?? 'rehearsal';
  const cfg = ENVS[env];
  const host = /** @type {string} */ (ctx.args.values.host);
  /** @param {string} m */
  const refuse = (m) => {
    err(`bootstrap: ${m}`);
    return 2;
  };
  if (env !== 'rehearsal' || !cfg?.nodeDir) return refuse('лише --env rehearsal');
  const nodeDir = cfg.nodeDir;

  // Перший вхід (accept-new, root) іде на ту саму адресу, яку щойно перевірено, а не на повторне розв’язання імені
  // (TOCTOU); `HostKeyAlias` — ім’я, яке ввів оператор, тож `known_hosts` лишається за ним.
  const checked = await checkTarget(host, ctx.deps);
  if (!checked.ok) return refuse(checked.message);
  if (!checked.address) return refuse(`${host}: немає IPv4-адреси — перший вхід лише на перевірену IPv4-адресу`);
  const pin = checked.address === host ? { host } : { host: checked.address, hostKeyAlias: host };
  const knownHosts = knownHostsFile(ctx);
  /** @type {Transport} */
  let asRoot;
  /** @type {Transport} */
  let asDeploy;
  try {
    // Перший вхід — довіра до ключа хоста при першій зустрічі (accept-new) у `known_hosts`; далі ключ закріплений.
    asRoot = ctx.deps.sshAs({ ...pin, user: 'root', knownHostsFile: knownHosts });
    asDeploy = ctx.deps.sshAs({ ...pin, user: DEPLOY_USER, knownHostsFile: knownHosts });
  } catch (e) {
    return refuse(messageOf(e));
  }

  try {
    const rootIn = await remote(asRoot, ['true']);
    if (rootIn.code === 0) {
      await printFingerprint(ctx, host, knownHosts);
      return await rootPath(ctx, { asRoot, asDeploy, nodeDir });
    }
    const deployIn = await remote(asDeploy, ['true']);
    if (deployIn.code !== 0) {
      err(`bootstrap: не вдалося увійти ні як root, ні як deploy (коди ${rootIn.code}, ${deployIn.code})`);
      return 1;
    }
    await printFingerprint(ctx, host, knownHosts);
    out('bootstrap: root не входить — повторна перевірка від імені deploy');
    return await deployPath(ctx, { asDeploy, nodeDir });
  } catch (e) {
    err(`bootstrap: ${messageOf(e)}`);
    return 1;
  }
}

/**
 * Відбиток ключа хоста з `known_hosts` — власник звіряє його з консоллю провайдера. Відбиток не секрет.
 * @param {OpsContext} ctx
 * @param {string} host
 * @param {string} knownHosts
 */
async function printFingerprint(ctx, host, knownHosts) {
  const r = await ctx.exec.run('ssh-keygen', ['-l', '-F', host, '-f', knownHosts], { timeoutMs: REMOTE_TIMEOUT_MS });
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  if (r.code !== 0 || !lines.length) {
    ctx.err(`bootstrap: відбиток ключа хоста не прочитано (код ${r.code}) — звірте ключ вручну`);
    return;
  }
  ctx.out('bootstrap: відбиток ключа хоста (звірте з консоллю провайдера):');
  for (const l of lines) ctx.out(`  ${l.trim()}`);
}

/**
 * @param {OpsContext} ctx
 * @param {{ asRoot: Transport, asDeploy: Transport, nodeDir: string }} o
 * @returns {Promise<number>}
 */
async function rootPath(ctx, { asRoot, asDeploy, nodeDir }) {
  const { out, err } = ctx;
  let changed = 0;
  /** @param {Step} s */
  const passes = async (s) => {
    const r = await remote(asRoot, s.check(nodeDir));
    return s.ok ? s.ok(r) : r.code === 0;
  };

  // Нумерація у виводі: кроки до `sshd` — 1…k, перевірка входу `deploy` — k+1, `sshd` — k+2.
  const sshdAt = ROOT_STEPS.findIndex((x) => x.id === 'sshd');
  const loginN = sshdAt + 1;
  for (const [i, s] of ROOT_STEPS.entries()) {
    const n = i < sshdAt ? i + 1 : i + 2;
    if (s.id === 'sshd') {
      // Запобіжник від блокування: вимикати root можна лише коли `deploy` входить тим самим ключем.
      const login = await remote(asDeploy, ['true']);
      if (login.code !== 0) {
        err(`bootstrap: ${loginN} ${LOGIN_STEP_ID} — ssh deploy@вузол не працює (код ${login.code}); вхід root НЕ вимкнено`);
        return 1;
      }
      out(`bootstrap: ${loginN} ${LOGIN_STEP_ID} — вхід deploy працює`);
    }
    if (await passes(s)) {
      out(`bootstrap: ${n} ${s.id} — вже зроблено`);
      continue;
    }
    if (!s.apply) return 1;
    const r = await remote(asRoot, s.apply(nodeDir), { input: s.input, timeoutMs: s.timeoutMs });
    changed += 1;
    if (r.code !== 0 || !(await passes(s))) {
      err(`bootstrap: ${n} ${s.id} (${s.title}) не вдався (код ${r.code})`);
      for (const l of String(r.stderr).split(/\r?\n/).filter((x) => x.trim() !== '').slice(-10)) err(`  ${l}`);
      return 1;
    }
    out(`bootstrap: ${n} ${s.id} — зроблено`);
  }

  if (changed > 0) {
    // Після вимкнення root новий вхід `deploy` має далі працювати.
    const again = await remote(asDeploy, ['true']);
    if (again.code !== 0) {
      err(`bootstrap: після змін ssh deploy@вузол не працює (код ${again.code}) — відкрийте консоль провайдера`);
      return 1;
    }
    out('bootstrap: готово');
  } else {
    out('bootstrap: без змін');
  }
  return 0;
}

/**
 * Повторний запуск, коли root уже не входить: лише перевірки від імені `deploy`, жодних змін.
 * @param {OpsContext} ctx
 * @param {{ asDeploy: Transport, nodeDir: string }} o
 * @returns {Promise<number>}
 */
async function deployPath(ctx, { asDeploy, nodeDir }) {
  const { out, err } = ctx;
  for (const s of DEPLOY_CHECKS) {
    const r = await remote(asDeploy, s.check(nodeDir));
    if (r.code !== 0) {
      err(`bootstrap: ${s.id} (${s.title}) — не пройшло (код ${r.code}); root вимкнено, виправте через консоль провайдера`);
      return 1;
    }
    out(`bootstrap: ${s.id} — без змін`);
  }
  out(`bootstrap: користувач root, брандмауер, sshd — ${ROOT_ONLY_NOTE}`);
  out('bootstrap: без змін');
  return 0;
}
