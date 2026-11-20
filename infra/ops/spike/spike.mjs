// @ts-check
// Спайк П-RT (docs/backend/spike-rt-plan.md): `node infra/ops/spike/spike.mjs <команда> …`
//   plan [--generators N]                         — ціни з API провайдера (лише читання), план, відмова за ціною
//   create --confirm spike [--generators N]       — вузли з тегами + підготовка по SSH (повтор безпечний)
//   cf-up --confirm spike | cf-down --confirm spike | cf-status   — тунель, CNAME, одне конфіг-правило (план §7)
//   run <S0|S1|S2|S3|S4> [--protocol http2] [--label r1] [--storm-window 30s] [--conns N] [--ramp 30s] [--hold 2m]
//       [--storm-at 40s] [--restart-at 60s] [--fast-last 30s] [--live-history N] [--log-level debug|info] [--local]
//   status | delete --confirm spike | digest <тека прогону> | local-down
// Спільне: [--secrets-file <шлях>] (змінні лише доповнюють оточення; секретні — маскуються).
// Корінь композиції: справжні порти (провайдер, SSH, мережа, процеси) складаються тут; тести підставляють свої.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { loadProvider } from '../lib/capacity/providers.mjs';
import { SECRET_ENV_NAMES } from '../lib/config.mjs';
import { realExec, run as runProcess } from '../lib/exec.mjs';
import { SYSTEM_CLOCK } from '../lib/node.mjs';
import { createOutput, redactorFromEnv } from '../lib/redact.mjs';
import { checkTimeSync } from '../lib/bootstrap.mjs';
import { apiFrom, cfDown, cfStatus, cfUp } from './lib/cloudflare.mjs';
import { CF, CF_ENV, COMPOSE_FILE, FILES, NODE_DIR, PROJECT, ROLE_TAGS, SCENARIOS, SPIKE_SECRET_FILES, STATE_DIR } from './lib/config.mjs';
import { evaluate, digestLines } from './lib/digest.mjs';
import { localNode, remoteNode } from './lib/fleet.mjs';
import { journal, readJournal } from './lib/journal.mjs';
import { cmdCreate, cmdDelete, cmdPlan, cmdStatus, ensureSpikeSecrets, knownHosts, roleOf, spikeNodes } from './lib/nodes.mjs';
import { lifetime, runGuard } from './lib/plan.mjs';
import { runScenario } from './lib/run.mjs';

const COMMANDS = ['plan', 'create', 'cf-up', 'cf-down', 'cf-status', 'run', 'status', 'delete', 'digest', 'local-down'];
const MUTATING = ['create', 'cf-up', 'cf-down', 'delete'];
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL)/i;
/** Локальний сухий прогін: не більше стільки з’єднань (одна машина розробника). */
export const LOCAL_MAX_CONNS = 1000;

/** Значення прапорців: перелік дозволеного. @type {Record<string, RegExp>} */
const FLAGS = {
  confirm: /^spike$/,
  generators: /^[1-8]$/,
  protocol: /^(auto|http2|quic)$/,
  label: /^[a-z0-9][a-z0-9-]{0,19}$/,
  'storm-window': /^\d{1,4}s?$/,
  'storm-at': /^\d{1,5}s?$/,
  'restart-at': /^\d{1,5}s?$/,
  conns: /^\d{1,6}$/,
  ramp: /^\d{1,5}(s|m)?$/,
  hold: /^\d{1,5}(s|m)?$/,
  'live-history': /^\d{1,5}$/,
  'fast-last': /^\d{1,5}s?$/,
  'batch-ms': /^\d{2,5}$/,
  'log-level': /^(debug|info|warn|error)$/,
  'secrets-file': /^[^-].{0,4095}$/,
};
const BOOL_FLAGS = ['local'];

/** «30s» / «2m» / «45» → секунди. @param {string} v */
const secs = (v) => (v.endsWith('m') ? Number(v.slice(0, -1)) * 60 : Number(v.replace(/s$/, '')));

/**
 * @param {string[]} argv
 * @returns {{ ok: true, cmd: string, pos: string[], values: Record<string, string>, flags: Record<string, boolean> } | { ok: false, message: string }}
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || !COMMANDS.includes(cmd)) return { ok: false, message: `usage: spike <${COMMANDS.join('|')}> …` };
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, boolean>} */
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const name = a.slice(2);
    if (BOOL_FLAGS.includes(name)) {
      flags[name] = true;
      continue;
    }
    const re = FLAGS[name];
    const v = rest[i + 1];
    if (!re) return { ok: false, message: `невідомий прапорець --${name.replace(/[^a-z0-9-]/gi, '?')}` };
    if (v === undefined || !re.test(v)) return { ok: false, message: `--${name}: недопустиме значення` };
    values[name] = v;
    i++;
  }
  if (MUTATING.includes(cmd) && values.confirm !== 'spike') return { ok: false, message: `${cmd}: потрібно --confirm spike` };
  if (cmd === 'run' && !(pos[0] && Object.hasOwn(SCENARIOS, pos[0]))) return { ok: false, message: `run: сценарій — один з ${Object.keys(SCENARIOS).join(', ')}` };
  if (cmd === 'digest' && !pos[0]) return { ok: false, message: 'digest: потрібна тека прогону' };
  return { ok: true, cmd, pos, values, flags };
}

/**
 * Сценарій з перевизначеннями з прапорців.
 * @param {string} name
 * @param {Record<string, string>} v
 * @returns {import('./lib/config.mjs').Scenario}
 */
export function scenarioWith(name, v) {
  const base = SCENARIOS[name];
  if (!base) throw new Error(`невідомий сценарій ${name}`);
  const sc = structuredClone(base);
  if (v.conns !== undefined) sc.conns = Number(v.conns);
  if (v.ramp !== undefined) sc.rampSec = secs(v.ramp);
  if (v.hold !== undefined) {
    sc.holdSec = secs(v.hold);
    sc.fastLastSec = Math.min(sc.fastLastSec, sc.holdSec);
  }
  if (v['fast-last'] !== undefined) sc.fastLastSec = Math.min(secs(v['fast-last']), sc.holdSec);
  // Легкий профіль (20.11, після S1): той самий інтервал і для «швидкої» фази.
  if (v['batch-ms'] !== undefined) sc.batchMs = sc.batchMs2 = Number(v['batch-ms']);
  if (sc.storm && v['storm-window'] !== undefined) sc.storm.windowSec = secs(v['storm-window']);
  if (sc.storm && v['storm-at'] !== undefined) sc.storm.atSec = secs(v['storm-at']);
  if (sc.restart && v['restart-at'] !== undefined) sc.restart.atSec = secs(v['restart-at']);
  // Шквал і перезапуск — завжди всередині утримання.
  const total = sc.rampSec + sc.holdSec;
  if (sc.storm && sc.storm.atSec + sc.storm.windowSec > total - 10) throw new Error('шквал виходить за утримання');
  if (sc.restart && sc.restart.atSec > total - 10) throw new Error('перезапуск виходить за утримання');
  return sc;
}

/**
 * @typedef {import('../lib/capacity/provider.mjs').Provider} Provider
 * @typedef {import('../lib/exec.mjs').Transport} Transport
 * @typedef {{
 *   env?: Record<string, string | undefined>,
 *   out?: (l: string) => void,
 *   err?: (l: string) => void,
 *   now?: () => Date,
 *   sleep?: (ms: number) => Promise<void>,
 *   stateDir?: string,
 *   provider?: () => Promise<Provider>,
 *   fetch?: typeof globalThis.fetch,
 *   sshAs?: (o: { host: string, user: string, knownHostsFile: string }) => Transport,
 *   runLocal?: import('./lib/fleet.mjs').LocalRun,
 * }} SpikeOverrides
 */

/**
 * @param {string[]} argv
 * @param {SpikeOverrides} [o]
 * @returns {Promise<number>}
 */
export async function main(argv, o = {}) {
  /** @type {Record<string, string | undefined>} */
  let env = o.env ?? process.env;
  const redactor = redactorFromEnv(env);
  const { out, err } = createOutput(redactor, o.out ?? ((l) => console.log(l)), o.err ?? o.out ?? ((l) => console.error(l)));
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`spike: ${parsed.message}`);
    return 2;
  }
  const { cmd, pos, values, flags } = parsed;
  if (values['secrets-file'] !== undefined) {
    /** @type {Record<string, string | undefined>} */
    let vars;
    try {
      vars = parseEnv(fs.readFileSync(values['secrets-file'], 'utf8'));
    } catch {
      err('spike: не вдалося прочитати --secrets-file');
      return 2;
    }
    env = { ...env };
    for (const [k, v] of Object.entries(vars)) {
      if (env[k] === undefined && v !== undefined) env[k] = v;
      if (SECRET_ENV_NAMES.includes(k) || SECRET_NAME_RE.test(k)) redactor.add(v);
    }
  }
  const stateDir = o.stateDir ?? STATE_DIR;
  for (const f of SPIKE_SECRET_FILES) {
    try {
      for (const v of Object.values(parseEnv(fs.readFileSync(path.join(stateDir, f), 'utf8')))) redactor.add(v);
    } catch {
      /* ще немає */
    }
  }
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms) => SYSTEM_CLOCK.sleep(ms));
  const doFetch = o.fetch ?? globalThis.fetch;
  const provider = o.provider ?? (async () => (await loadProvider({ env, fetch: doFetch, clock: SYSTEM_CLOCK })).provider);
  const sshAs = o.sshAs ?? ((s) => realExec.sshTransport({ ...s, accept: 'new' }));
  const runLocal = o.runLocal ?? ((file, args, opts) => runProcess(file, args, opts));
  /** @type {import('./lib/nodes.mjs').NodeCtx} */
  const nctx = { out, err, now, sleep, stateDir, redactor, provider, sshAs };
  const generators = Number(values.generators ?? '4');

  try {
    switch (cmd) {
      case 'plan':
        return (await cmdPlan(nctx, { generators })).code;
      case 'create':
        return await cmdCreate(nctx, { generators, composeText: fs.readFileSync(FILES.compose, 'utf8').replace(/\r\n/g, '\n') });
      case 'status':
        return (await cmdStatus(nctx)).code;
      case 'delete':
        return await cmdDelete(nctx);
      case 'cf-status':
      case 'cf-up':
      case 'cf-down':
        return await cloudflare(cmd, { env, doFetch, nctx });
      case 'run':
        return flags.local ? await runLocalScenario(pos[0] ?? '', values, { nctx, runLocal }) : await runRemote(pos[0] ?? '', values, { nctx });
      case 'digest':
        return digestDir(pos[0] ?? '', nctx);
      case 'local-down': {
        const node = localNode(path.join(stateDir, 'local'), runLocal);
        const r = await node.compose(['--profile', 'run', '--profile', 'collector', 'down', '-v', '--remove-orphans'], { timeoutMs: 300_000 });
        await node.docker(['rm', '-f', 't2f-spike-k6']);
        out(`spike local-down: код ${r.code}`);
        return r.code === 0 ? 0 : 1;
      }
      default:
        return 2;
    }
  } catch (e) {
    err(`spike ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    try {
      if (MUTATING.includes(cmd) || cmd === 'run') journal(stateDir, redactor, now(), cmd, 'error', 'failed', {});
    } catch {
      /* журнал не критичний для повідомлення про помилку */
    }
    return 1;
  }
}

/**
 * Вузол realtime спайку як транспорт SSH (root).
 * @param {import('./lib/nodes.mjs').NodeCtx} nctx
 */
async function realtimeTransport(nctx) {
  const { ours } = await spikeNodes(await nctx.provider());
  const node = ours.find((n) => roleOf(n) === 'realtime');
  if (!node?.publicIp) return null;
  return { node, t: nctx.sshAs({ host: node.publicIp, user: 'root', knownHostsFile: knownHosts(nctx) }) };
}

/**
 * @param {string} cmd
 * @param {{ env: Record<string, string | undefined>, doFetch: typeof globalThis.fetch, nctx: import('./lib/nodes.mjs').NodeCtx }} o
 */
async function cloudflare(cmd, o) {
  const { nctx } = o;
  const { out, err } = nctx;
  const { missing, api, account, zone } = apiFrom(o.env, o.doFetch);
  if (!api) {
    err(`spike ${cmd}: бракує змінних ${missing.join(', ')} (назви: ${Object.values(CF_ENV).join(', ')})`);
    return 2;
  }
  const ids = { account, zone };
  if (cmd === 'cf-status') {
    await cfStatus({ api, ids, out });
    return 0;
  }
  const rt = await realtimeTransport(nctx);
  /** @param {Transport} t @param {string[]} argv @param {string} [input] */
  const remote = (t, argv, input) => t.exec(argv, { allow: [...argv], timeoutMs: 300_000, ...(input !== undefined ? { input } : {}) });
  const compose = ['docker', 'compose', '-p', PROJECT, '-f', `${NODE_DIR}/${COMPOSE_FILE}`, '--project-directory', NODE_DIR];
  if (cmd === 'cf-up') {
    if (!rt) {
      err('spike cf-up: вузла realtime немає — спершу create (токен тунелю нікуди покласти); у Cloudflare нічого не змінено');
      return 2;
    }
    const r = await cfUp({
      api,
      ids,
      out,
      register: (v) => nctx.redactor.add(v),
      deliverToken: async (token) => {
        const w = await remote(rt.t, ['sh', '-c', 'set -e; umask 077; cat > "$1.tmp"; mv "$1.tmp" "$1"', '_', `${NODE_DIR}/cloudflared.env`], `TUNNEL_TOKEN=${token}\n`);
        if (w.code !== 0) throw new Error('cloudflared.env на вузлі не записано');
        const u = await remote(rt.t, [...compose, 'up', '-d', '--force-recreate', 'cloudflared-a', 'cloudflared-b']);
        if (u.code !== 0) throw new Error(`cloudflared не запущено (код ${u.code})`);
        out(`spike cf-up: дві копії cloudflared запущено на ${rt.node.name}`);
      },
    });
    journal(nctx.stateDir, nctx.redactor, nctx.now(), 'cf-up', 'cloudflare', 'ok', { tunnelId: r.tunnelId, recordId: r.recordId, ruleId: r.ruleId, rulesBefore: r.rulesBefore, created: r.created });
    out(`spike cf-up: готово; публічне ім’я ${CF.host}`);
    return 0;
  }
  const lastUp = readJournal(nctx.stateDir).filter((x) => x.cmd === 'cf-up' && x.result === 'ok' && typeof x.rulesBefore === 'number').pop();
  const r = await cfDown({
    api,
    ids,
    out,
    rulesBefore: lastUp ? lastUp.rulesBefore : null,
    stopConnectors: async () => {
      if (!rt) return;
      await remote(rt.t, [...compose, 'rm', '-sf', 'cloudflared-a', 'cloudflared-b']);
      await remote(rt.t, ['sh', '-c', ': > "$1"', '_', `${NODE_DIR}/cloudflared.env`]);
      out(`spike cf-down: cloudflared на ${rt.node.name} зупинено, токен стерто`);
    },
  });
  journal(nctx.stateDir, nctx.redactor, nctx.now(), 'cf-down', 'cloudflare', 'ok', { removed: r.removed, rulesAfter: r.rulesAfter });
  return 0;
}

/**
 * `run` на вузлах спайку.
 * @param {string} scenario
 * @param {Record<string, string>} v
 * @param {{ nctx: import('./lib/nodes.mjs').NodeCtx }} o
 */
async function runRemote(scenario, v, o) {
  const { nctx } = o;
  const sc = scenarioWith(scenario, v);
  const p = await nctx.provider();
  const { ours } = await spikeNodes(p);
  const rtNode = ours.find((n) => roleOf(n) === 'realtime');
  const genNodes = ours.filter((n) => roleOf(n) === 'loadgen').sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!rtNode?.publicIp || genNodes.length === 0 || genNodes.some((g) => !g.publicIp)) {
    nctx.err('spike run: потрібні вузол realtime і хоча б один генератор з адресами — спершу create');
    return 2;
  }
  const lt = lifetime(ours, await p.sizes(), nctx.now().getTime());
  const reasons = runGuard(lt, sc.rampSec + sc.holdSec + 600);
  if (reasons.length) {
    for (const r of reasons) nctx.err(`spike run: ВІДМОВА: ${r}`);
    return 2;
  }
  /** @param {import('../lib/capacity/provider.mjs').Node} n */
  const t = (n) => nctx.sshAs({ host: /** @type {string} */ (n.publicIp), user: 'root', knownHostsFile: knownHosts(nctx) });
  const rtT = t(rtNode);
  const tok = await rtT.exec(['sh', '-c', 'grep -q "^TUNNEL_TOKEN=." "$1"', '_', `${NODE_DIR}/cloudflared.env`], { allow: ['sh', '-c', 'grep -q "^TUNNEL_TOKEN=." "$1"', '_', `${NODE_DIR}/cloudflared.env`], timeoutMs: 60_000 });
  if (tok.code !== 0) {
    nctx.err('spike run: на вузлі realtime немає токена тунелю — спершу cf-up --confirm spike');
    return 2;
  }
  for (const n of [rtNode, ...genNodes]) {
    const ok = await checkTimeSync(t(n), { out: (l) => nctx.out(`${n.name}: ${l}`), err: (l) => nctx.err(`${n.name}: ${l}`) }, 'час');
    if (!ok) return 2;
  }
  journal(nctx.stateDir, nctx.redactor, nctx.now(), 'run', 'start', 'ok', { scenario, label: v.label ?? null, protocol: v.protocol ?? 'auto', conns: sc.conns });
  const res = await runScenario(
    { out: nctx.out, err: nctx.err, now: nctx.now, sleep: nctx.sleep },
    {
      scenario,
      sc,
      label: v.label,
      protocol: v.protocol === 'http2' ? 'http2' : 'auto',
      local: false,
      realtime: remoteNode(rtNode.name, rtT),
      gens: genNodes.map((n) => remoteNode(n.name, t(n))),
      wsUrl: `wss://${CF.host}/connection/websocket`,
      origin: CF.origin,
      k6Network: 'host',
      runsDir: path.join(nctx.stateDir, 'runs'),
      logLevel: v['log-level'] ?? 'debug',
      liveHistory: v['live-history'] !== undefined ? Number(v['live-history']) : undefined,
    },
  );
  journal(nctx.stateDir, nctx.redactor, nctx.now(), 'run', 'finish', res.code === 0 ? 'ok' : 'failed', { scenario, overall: res.evaluation?.overall ?? null, runDir: path.basename(res.runDir) });
  return res.code;
}

/**
 * `run --local`: той самий конвеєр на Docker цієї машини (Redis + Centrifugo з compose.rtspike.yml, без cloudflared),
 * один генератор k6 у мережі спайку. DigitalOcean і Cloudflare не використовуються.
 * @param {string} scenario
 * @param {Record<string, string>} v
 * @param {{ nctx: import('./lib/nodes.mjs').NodeCtx, runLocal: import('./lib/fleet.mjs').LocalRun }} o
 */
async function runLocalScenario(scenario, v, o) {
  const { nctx } = o;
  const sc = scenarioWith(scenario, v);
  if (sc.conns > LOCAL_MAX_CONNS) {
    nctx.err(`spike run --local: ${sc.conns} з’єднань — понад ${LOCAL_MAX_CONNS} для однієї машини; задайте --conns`);
    return 2;
  }
  if (sc.restart?.target === 'cloudflared') {
    nctx.err('spike run --local: cloudflared локально немає (S4 — лише на вузлах)');
    return 2;
  }
  const dir = path.join(nctx.stateDir, 'local');
  const node = localNode(dir, o.runLocal);
  await node.prepareOut();
  const secrets = ensureSpikeSecrets(path.join(dir, 'secrets'), nctx.redactor);
  await node.writeFile(COMPOSE_FILE, fs.readFileSync(FILES.compose, 'utf8'));
  await node.writeFile('redis.env', secrets['redis.env']);
  await node.writeFile('centrifugo.env', secrets['centrifugo.env']);
  for (const f of ['cloudflared.env', 'publisher.env']) if ((await node.readFile(f)) === null) await node.writeFile(f, '');
  await node.writeFile('collector/rtspike-collector.sh', fs.readFileSync(FILES.collector, 'utf8').replace(/\r\n/g, '\n'));
  const res = await runScenario(
    { out: nctx.out, err: nctx.err, now: nctx.now, sleep: nctx.sleep },
    {
      scenario,
      sc,
      label: v.label ? `local-${v.label}` : 'local',
      protocol: 'auto',
      local: true,
      realtime: node,
      gens: [node],
      wsUrl: 'ws://centrifugo:8000/connection/websocket',
      origin: CF.origin,
      k6Network: `${PROJECT}_spike`,
      runsDir: path.join(nctx.stateDir, 'runs'),
      logLevel: v['log-level'] ?? 'debug',
      liveHistory: v['live-history'] !== undefined ? Number(v['live-history']) : undefined,
    },
  );
  return res.code;
}

/**
 * `digest <тека>`: повторна оцінка збереженого прогону.
 * @param {string} dir
 * @param {import('./lib/nodes.mjs').NodeCtx} nctx
 */
function digestDir(dir, nctx) {
  /** @param {string} f */
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      return null;
    }
  };
  const meta = JSON.parse(read('meta.json') ?? 'null');
  if (!meta) {
    nctx.err('spike digest: немає meta.json');
    return 2;
  }
  const files = fs.readdirSync(dir);
  /** @param {string} t */
  const jsonl = (t) => t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const e = evaluate({
    scenario: meta.scenario,
    sc: meta.sc,
    summaries: files.filter((f) => /^gen-\d+-summary\.json$/.test(f)).sort().map((f) => JSON.parse(read(f) ?? '{}')),
    publisher: read('publisher-summary.json') ? JSON.parse(/** @type {string} */ (read('publisher-summary.json'))) : null,
    collector: jsonl(read('collector.jsonl') ?? ''),
    genCollectors: files.filter((f) => /^gen-\d+-collector\.jsonl$/.test(f)).sort().map((f) => jsonl(read(f) ?? '')),
    t0Ms: meta.t0,
    local: meta.local,
  });
  for (const l of digestLines(`digest ${meta.scenario}${meta.local ? ' — ЛОКАЛЬНО' : ''}: ${meta.sc.title}`, e)) nctx.out(l);
  return 0;
}

export { ROLE_TAGS };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
