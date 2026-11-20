// @ts-check
// Прогін сценарію спайку: видавець і збирач на вузлі realtime, k6 `spike.js` на всіх генераторах зі спільним стартом
// (рампи збігаються), запланований перезапуск (S3 — Centrifugo, S4 — одна копія cloudflared), короткий хід, потім
// підсумки, журнали й рядок-висновок за порогами плану §5. Однаково для вузлів DigitalOcean і для локального Docker.
import fs from 'node:fs';
import path from 'node:path';
import { CF, CONTAINERS, FILES, K6_IMAGE } from './config.mjs';
import { digestLines, evaluate } from './digest.mjs';
import { splitConnections } from './plan.mjs';

/**
 * @typedef {import('./fleet.mjs').FleetNode} FleetNode
 * @typedef {import('./config.mjs').Scenario} Scenario
 * @typedef {{
 *   out: (l: string) => void,
 *   err: (l: string) => void,
 *   now: () => Date,
 *   sleep: (ms: number) => Promise<void>,
 * }} RunIo
 * @typedef {{
 *   scenario: string,
 *   sc: Scenario,
 *   label?: string,
 *   protocol: 'auto' | 'http2',
 *   local: boolean,
 *   realtime: FleetNode,
 *   gens: FleetNode[],
 *   wsUrl: string,
 *   origin: string,
 *   k6Network: string,
 *   runsDir: string,
 *   logLevel?: string,
 *   liveHistory?: number,
 *   leadSec?: number,
 *   connsPerVu?: number,
 * }} RunOpts
 */

/** Значення для env-файлу k6 (без переводів рядка). @param {Record<string, string | number>} env */
export const envText = (env) =>
  Object.entries(env)
    .map(([k, v]) => {
      const s = String(v);
      if (/[\r\n]/.test(s)) throw new Error(`env ${k}: перевод рядка`);
      return `${k}=${s}`;
    })
    .join('\n') + '\n';

/**
 * Env генератора `i` з `n`.
 * @param {RunOpts} o @param {number} t0 @param {number} conns @param {number} i @param {number} n
 */
export function genEnv(o, t0, conns, i, n) {
  const { sc } = o;
  /** @type {Record<string, string | number>} */
  const env = {
    WS_URL: o.wsUrl,
    ORIGIN: o.origin,
    CONNS: conns,
    CONNS_PER_VU: o.connsPerVu ?? 50,
    RAMP: `${sc.rampSec}s`,
    DURATION: `${sc.holdSec}s`,
    CHANNELS: 'live:spike,site:state',
    LATENCY_SAMPLE: 0.1,
    START_AT: t0,
    GEN_INDEX: i,
    GEN_COUNT: n,
    SUMMARY_FILE: '/out/summary.json',
  };
  if (sc.storm) {
    env.STORM_AT = `${sc.storm.atSec}s`;
    env.STORM_WINDOW = `${sc.storm.windowSec}s`;
  }
  return env;
}

/** @param {RunOpts} o @param {number} t0 */
export function publisherEnv(o, t0) {
  const { sc } = o;
  return {
    API_URL: 'http://centrifugo:9000',
    START_AT: t0,
    DELAY: `${sc.rampSec}s`,
    DURATION: `${sc.holdSec}s`,
    BATCH_MS: sc.batchMs,
    BATCH_MS_2: sc.batchMs2,
    FAST_LAST: `${sc.fastLastSec}s`,
    PAYLOAD_BYTES: 1000,
    SUMMARY_FILE: '/out/publisher-summary.json',
  };
}

/** @param {string} text @returns {any[]} */
const jsonl = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

/**
 * Причини розривів з журналу Centrifugo (рядки з `disconnect`): частоти за `reason`.
 * @param {string} log
 */
export function disconnectReasons(log) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const line of String(log).split(/\r?\n/)) {
    if (!/disconnect|closing client|"reason"/i.test(line)) continue;
    const m = /reason[=":\s]+"?([^",}\n]+)/.exec(line);
    const k = (m ? m[1] : 'other').trim().slice(0, 60);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Прогін.
 * @param {RunIo} io
 * @param {RunOpts} o
 * @returns {Promise<{ code: number, runDir: string, evaluation: ReturnType<typeof evaluate> | null }>}
 */
export async function runScenario(io, o) {
  const { out, err } = io;
  const { sc, realtime, gens } = o;
  const total = sc.rampSec + sc.holdSec;
  const stamp = io.now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runDir = path.join(o.runsDir, `${stamp}-${o.scenario}${o.label ? `-${o.label}` : ''}`);
  fs.mkdirSync(runDir, { recursive: true });
  const splits = splitConnections(sc.conns, gens.length);
  /** @param {string} name @param {string} text */
  const save = (name, text) => fs.writeFileSync(path.join(runDir, name), text);

  // 1. Вузол realtime: скрипти, збирач, змінні Compose, видавець.
  await realtime.prepareOut();
  await realtime.writeFile('k6/spike-publisher.js', fs.readFileSync(path.join(FILES.k6Dir, 'spike-publisher.js'), 'utf8'));
  await realtime.writeFile('collector/rtspike-collector.sh', fs.readFileSync(FILES.collector, 'utf8').replace(/\r\n/g, '\n'));
  await realtime.writeFile(
    '.env',
    envText({ SPIKE_ORIGIN: o.origin, SPIKE_TUNNEL_PROTOCOL: o.protocol, SPIKE_LOG_LEVEL: o.logLevel ?? 'debug', SPIKE_LIVE_HISTORY_SIZE: o.liveHistory ?? 10 }),
  );
  const services = o.local ? ['redis', 'centrifugo'] : ['redis', 'centrifugo', 'cloudflared-a', 'cloudflared-b'];
  const up = await realtime.compose(['up', '-d', ...services], { timeoutMs: 600_000 });
  if (up.code !== 0) throw new Error(`compose up на ${realtime.name}: код ${up.code}: ${up.stderr.trim().split('\n').slice(-2).join(' ')}`);
  for (let i = 0; ; i++) {
    const h = await realtime.docker(['inspect', '-f', '{{.State.Health.Status}}', CONTAINERS.centrifugo]);
    if (h.stdout.trim() === 'healthy') break;
    if (i >= 60) throw new Error('Centrifugo не став healthy за 2 хв');
    await io.sleep(2000);
  }
  out(`run ${o.scenario}: ${realtime.name}: ${services.join(', ')} працюють${o.local ? '' : `, тунель --protocol ${o.protocol}`}`);

  // 2. Генератори: скрипт, збирач (віддалено), env кожного.
  const leadMs = (o.leadSec ?? (o.local ? 20 : 90)) * 1000;
  const t0 = io.now().getTime() + leadMs;
  for (const [i, g] of gens.entries()) {
    await g.prepareOut();
    await g.writeFile('k6/spike.js', fs.readFileSync(path.join(FILES.k6Dir, 'spike.js'), 'utf8'));
    await g.writeFile('k6.env', envText(genEnv(o, t0, splits[i] ?? 0, i, gens.length)));
    if (g.kind === 'remote') await g.writeFile('collector/rtspike-collector.sh', fs.readFileSync(FILES.collector, 'utf8').replace(/\r\n/g, '\n'));
  }
  await realtime.writeFile('publisher.env', envText(publisherEnv(o, t0)));
  save('meta.json', JSON.stringify({ scenario: o.scenario, label: o.label ?? null, protocol: o.protocol, local: o.local, t0, sc, splits, wsUrl: o.wsUrl, origin: o.origin, generators: gens.map((g) => g.name) }, null, 2));

  // 3. Старт: збирачі, видавець, k6 на генераторах (усі чекають t0 у setup()).
  await realtime.startCollector(CONTAINERS.centrifugo);
  for (const g of gens) if (g.kind === 'remote') await g.startCollector('');
  const pub = await realtime.compose(['--profile', 'run', 'up', '-d', '--force-recreate', '--no-deps', 'publisher'], { timeoutMs: 300_000 });
  if (pub.code !== 0) throw new Error(`видавець не запущено: ${pub.stderr.trim().split('\n').pop()}`);
  for (const [i, g] of gens.entries()) {
    await g.docker(['rm', '-f', CONTAINERS.k6]);
    const r = await g.docker(
      [
        'run', '-d', '--name', CONTAINERS.k6, '--network', o.k6Network,
        // Скрипти й out на вузлі створено з umask 077 від root; образ k6 працює як uid 12345 — без root не прочитає.
        '--user', '0',
        '--ulimit', 'nofile=250000:250000',
        '-v', `${g.path('k6')}:/scripts:ro`, '-v', `${g.path('out')}:/out`,
        '--env-file', g.path('k6.env'),
        K6_IMAGE, 'run', '--quiet', '/scripts/spike.js',
      ],
      { timeoutMs: 300_000 },
    );
    if (r.code !== 0) throw new Error(`k6 на ${g.name} не запущено: ${r.stderr.trim().split('\n').pop()}`);
    out(`run ${o.scenario}: ${g.name}: k6 запущено, ${splits[i]} з’єднань`);
  }
  out(`run ${o.scenario}: спільний старт ${new Date(t0).toISOString()}, рампа ${sc.rampSec} с, утримання ${sc.holdSec} с${sc.storm ? `, шквал на ${sc.storm.atSec} с у вікні ${sc.storm.windowSec} с` : ''}${sc.restart ? `, перезапуск ${sc.restart.target} на ${sc.restart.atSec} с` : ''}`);

  // 4. Хід і запланований перезапуск.
  let restarted = false;
  const deadline = t0 + (total + 180) * 1000;
  const every = o.local ? 15_000 : 30_000;
  for (;;) {
    await io.sleep(every);
    const nowMs = io.now().getTime();
    if (sc.restart && !restarted && nowMs >= t0 + sc.restart.atSec * 1000) {
      const target = sc.restart.target === 'centrifugo' ? CONTAINERS.centrifugo : CONTAINERS.cloudflaredB;
      const r = await realtime.docker(['restart', target], { timeoutMs: 180_000 });
      restarted = true;
      out(`run ${o.scenario}: t+${Math.round((nowMs - t0) / 1000)} с: docker restart ${target} → код ${r.code}`);
    }
    /** @type {string[]} */
    const states = [];
    for (const g of gens) states.push((await g.docker(['inspect', '-f', '{{.State.Running}}', CONTAINERS.k6])).stdout.trim());
    let line = '';
    try {
      const l = JSON.parse(await realtime.lastLine('out/collector.jsonl'));
      line = `клієнтів ${l.centrifugo?.centrifugo_node_num_clients ?? '?'}, CPU ${l.cpu_pct}%, RAM ${l.mem_used_mb} МБ, TCP ${l.sock?.tcp_inuse ?? '?'}`;
    } catch {
      line = 'збирач ще не писав';
    }
    out(`run ${o.scenario}: t+${Math.round((nowMs - t0) / 1000)} с: ${line}; k6 працює: ${states.filter((s) => s === 'true').length}/${gens.length}`);
    if (states.every((s) => s !== 'true') && nowMs > t0) break;
    if (nowMs > deadline) {
      err(`run ${o.scenario}: k6 не завершився вчасно — зупиняю`);
      for (const g of gens) await g.docker(['stop', '-t', '30', CONTAINERS.k6]);
      break;
    }
  }

  // 5. Підсумки й журнали.
  /** @type {import('./digest.mjs').K6Summary[]} */
  const summaries = [];
  /** @type {any[][]} */
  const genCollectors = [];
  for (const [i, g] of gens.entries()) {
    const s = await g.readFile('out/summary.json');
    if (s) {
      save(`gen-${i}-summary.json`, s);
      summaries.push(JSON.parse(s));
    } else err(`run ${o.scenario}: ${g.name}: підсумку k6 немає`);
    const logs = await g.docker(['logs', CONTAINERS.k6], { timeoutMs: 120_000 });
    save(`gen-${i}-k6.log`, `${logs.stdout}${logs.stderr}`);
    await g.docker(['rm', '-f', CONTAINERS.k6]);
    if (g.kind === 'remote') {
      await g.stopCollector();
      const c = (await g.readFile('out/collector.jsonl')) ?? '';
      save(`gen-${i}-collector.jsonl`, c);
      genCollectors.push(jsonl(c));
    }
  }
  await realtime.stopCollector();
  const pubSummary = await realtime.readFile('out/publisher-summary.json');
  if (pubSummary) save('publisher-summary.json', pubSummary);
  await realtime.compose(['--profile', 'run', 'rm', '-sf', 'publisher']);
  const collectorText = (await realtime.readFile('out/collector.jsonl')) ?? '';
  save('collector.jsonl', collectorText);
  const since = String(Math.floor(t0 / 1000) - 60);
  const cLog = await realtime.docker(['logs', '--since', since, '--tail', '200000', CONTAINERS.centrifugo], { timeoutMs: 300_000 });
  save('centrifugo.log', `${cLog.stdout}${cLog.stderr}`);
  const reasons = disconnectReasons(`${cLog.stdout}${cLog.stderr}`);
  if (!o.local) {
    for (const c of [CONTAINERS.cloudflaredA, CONTAINERS.cloudflaredB]) {
      const l = await realtime.docker(['logs', '--since', since, '--tail', '50000', c], { timeoutMs: 300_000 });
      save(`${c}.log`, `${l.stdout}${l.stderr}`);
    }
  }
  const oom = (await realtime.docker(['inspect', '-f', '{{.State.OOMKilled}} {{.RestartCount}}', CONTAINERS.centrifugo])).stdout.trim();

  const evaluation = evaluate({
    scenario: o.scenario,
    sc,
    summaries,
    publisher: pubSummary ? JSON.parse(pubSummary) : null,
    collector: jsonl(collectorText),
    genCollectors,
    t0Ms: t0,
    oomKilled: oom.startsWith('true'),
    local: o.local,
  });
  const lines = digestLines(`run ${o.scenario}${o.label ? ` (${o.label})` : ''}${o.local ? ' — ЛОКАЛЬНО' : ''}: ${sc.title}; ${sc.conns} з’єднань на ${gens.length} генератор(и); ${o.local ? 'ws://centrifugo:8000' : CF.host}`, evaluation);
  lines.push(`  причини розривів (журнал Centrifugo): ${JSON.stringify(reasons)}`);
  lines.push(`  тека прогону: ${runDir}`);
  for (const l of lines) out(l);
  save('digest.txt', `${lines.join('\n')}\n`);
  save('digest.json', JSON.stringify({ rows: evaluation.rows, overall: evaluation.overall, unreliable: evaluation.unreliable, genCpu: evaluation.genCpu, merged: evaluation.merged, publisher: evaluation.publisher, reasons }, null, 2));
  return { code: summaries.length === gens.length ? 0 : 1, runDir, evaluation };
}
