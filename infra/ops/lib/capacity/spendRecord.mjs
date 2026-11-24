// @ts-check
// Години нічного розміру в рядок витрат `server` (SPEC-13b W43, [П-6], AC-63): після успішної зміни розміру
// основного вузла `capacity night|back` запускає на вузлі `pnpm run ops spend-record server --hours <h>
// --usd-per-hour <r> --reason capacity:<дія>:<розмір>` у контейнері сервера (наявний транспорт, `composeArgv`).
// `night` — 0 год зі ставкою (рядок журналу, лічильник не змінюється); `back` — години від останнього `night`
// з журналу потужності. Ставка — надбавка розміру над розміром поза сезоном (базова ціна $12/міс рахується окремо
// пропорційно дням). Невдалий запис НЕ робить зміну розміру невдалою: друкується команда для ручного запису.
// Попередження (Design review 9): `night`/`back` між :50 і :10 за Києвом — у вікні годинної копії бази.
import { DEPLOY_USER, knownHostsFile, messageOf } from '../common.mjs';
import { ENVS } from '../config.mjs';
import { createNode, CURRENT_ENV } from '../node.mjs';
import { journalFile, readJournal } from './execute.mjs';

const SPEND_TIMEOUT_MS = 60_000;

/**
 * Чи `now` у вікні годинної копії (:50 – :10). Київ відстає від UTC на цілі години, тож хвилини — ті самі.
 * @param {Date} now
 */
export function inBackupWindow(now) {
  const m = now.getUTCMinutes();
  return m >= 50 || m < 10;
}

/** Рядок попередження для `night`/`back` у вікні копії, інакше `null`. @param {string} action @param {Date} now */
export function backupWindowWarning(action, now) {
  if (action !== 'night' && action !== 'back') return null;
  if (!inBackupWindow(now)) return null;
  return `capacity: увага — ${action} між :50 і :10 (Київ) збігається з годинною копією бази; краще запускати поза цим вікном`;
}

/**
 * Що записати в рядок `server`: години й ставка. `back` без попереднього `night` у журналі — 0 год.
 * @param {{
 *   action: 'night' | 'back',
 *   nightSize: string | undefined,
 *   journal: any[],
 *   nowMs: number,
 *   priceOf: (slug: string) => number | undefined,
 *   offSeason: string,
 * }} o
 * @returns {{ hours: number, usdPerHour: number, size: string | null }}
 */
export function spendOf(o) {
  const base = o.priceOf(o.offSeason) ?? 0;
  const extra = (/** @type {string | undefined} */ slug) => (slug ? Math.max(0, (o.priceOf(slug) ?? 0) - base) : 0);
  const round = (/** @type {number} */ n, /** @type {number} */ d) => Math.round(n * 10 ** d) / 10 ** d;
  if (o.action === 'night') return { hours: 0, usdPerHour: round(extra(o.nightSize), 5), size: o.nightSize ?? null };
  const resizes = o.journal.filter((r) => r?.step === 'resize' && r?.result === 'ok' && (r?.action === 'night' || r?.action === 'back'));
  // Останній успішний `night` після останнього `back` (поточний `back` уже в журналі — він останній).
  const lastBackIdx = resizes.slice(0, -1).map((r) => r.action).lastIndexOf('back');
  const night = resizes.slice(lastBackIdx + 1).filter((r) => r.action === 'night').at(-1);
  const at = night ? Date.parse(String(night.at)) : NaN;
  if (!night || !Number.isFinite(at) || at > o.nowMs) return { hours: 0, usdPerHour: 0, size: null };
  return { hours: round((o.nowMs - at) / 3_600_000, 2), usdPerHour: round(extra(String(night.to)), 5), size: String(night.to) };
}

/**
 * Запис на вузлі; помилка друкується, код потужності не змінюється.
 * @param {import('../../ops.mjs').OpsContext} ctx
 * @param {{ env: string, action: 'night' | 'back', host: string | null, hours: number, usdPerHour: number, size: string | null }} o
 */
export async function recordServerSpend(ctx, o) {
  const reason = `capacity:${o.action}:${o.size ?? 'unknown'}`;
  const args = ['spend-record', 'server', '--hours', String(o.hours), '--usd-per-hour', String(o.usdPerHour), '--reason', reason];
  const manual = `на вузлі: pnpm run ops ${args.join(' ')}`;
  const cfg = ENVS[o.env];
  if (!o.host || !cfg?.nodeDir || !cfg.project) {
    ctx.err(`capacity: витрати не записано (немає адреси вузла); ${manual}`);
    return;
  }
  try {
    const t = ctx.deps.transport({ host: o.host, user: DEPLOY_USER, knownHostsFile: knownHostsFile(ctx) });
    const node = createNode({ transport: t, env: o.env, project: cfg.project, nodeDir: cfg.nodeDir, clock: ctx.deps.clock });
    const r = await t.exec(node.argv(CURRENT_ENV, ['exec', '-T', 'server', 'pnpm', 'run', 'ops', ...args]), { timeoutMs: SPEND_TIMEOUT_MS });
    if (r.code === 0) ctx.out(`capacity: витрати server — ${o.hours} год × $${o.usdPerHour}/год записано`);
    else ctx.err(`capacity: витрати не записано (код ${r.code}); ${manual}`);
  } catch (e) {
    ctx.err(`capacity: витрати не записано (${messageOf(e)}); ${manual}`);
  }
}

/**
 * Після успішного `night`/`back` зі зміною розміру основного вузла.
 * @param {import('../../ops.mjs').OpsContext} ctx
 * @param {{ env: string, action: string, steps: import('./plan.mjs').Step[], sizes: import('./provider.mjs').Size[], offSeason: string }} o
 */
export async function afterResize(ctx, o) {
  if (o.action !== 'night' && o.action !== 'back') return;
  const resize = o.steps.find((s) => s.kind === 'resize');
  if (!resize || resize.kind !== 'resize') return;
  const spend = spendOf({
    action: o.action,
    nightSize: o.action === 'night' ? resize.to : undefined,
    journal: readJournal(journalFile(ctx.paths, o.env)),
    nowMs: ctx.now().getTime(),
    priceOf: (slug) => o.sizes.find((s) => s.slug === slug)?.priceHourly,
    offSeason: o.offSeason,
  });
  await recordServerSpend(ctx, { env: o.env, action: o.action, host: resize.node.publicIp, ...spend });
}
