// @ts-check
// Підсумок прогону спайку: зведення підсумків k6 з усіх генераторів, рядки збирача метрик і пороги плану §5
// (зелений / жовтий / червоний; загальний — за найгіршим рядком). Чисті функції: читають лише передані дані.
import { THRESHOLDS } from './config.mjs';

/**
 * @typedef {'green' | 'yellow' | 'red' | 'n/a'} Grade
 * @typedef {{ key: string, title: string, value: string, grade: Grade, note?: string }} Row
 * @typedef {{ meta: Record<string, any>, metrics: Record<string, { type?: string, values: Record<string, number> }> }} K6Summary
 * @typedef {{ ts: number, cpu_pct: number, ncpu?: number, mem_used_mb?: number, mem_total_mb?: number, sock?: Record<string, number>,
 *   containers?: { name: string, cpu_pct: number, mem: string }[], centrifugo?: Record<string, any> }} CollectorLine
 */

/** @param {K6Summary} s @param {string} name @param {string} field */
const val = (s, name, field) => Number(s.metrics?.[name]?.values?.[field] ?? 0);

/**
 * Зведення підсумків генераторів: лічильники — сума; частки — зважено за passes/fails; перцентилі — максимум по
 * генераторах (обережна оцінка: точного злиття перцентилів без сирих даних немає); ряд «підключено» — сума за кошиками.
 * @param {K6Summary[]} list
 */
export function mergeSummaries(list) {
  /** @param {string} n */
  const sum = (n) => list.reduce((a, s) => a + val(s, n, 'count'), 0);
  /** @param {string} n */
  const rate = (n) => {
    const p = list.reduce((a, s) => a + val(s, n, 'passes'), 0);
    const f = list.reduce((a, s) => a + val(s, n, 'fails'), 0);
    return p + f === 0 ? null : p / (p + f);
  };
  /** @param {string} n @param {string} f */
  const max = (n, f) => list.reduce((a, s) => Math.max(a, val(s, n, f)), 0);
  /** @param {string} prefix @param {string} tag */
  const byTag = (prefix, tag) => {
    /** @type {Record<string, number>} */
    const out = {};
    for (const s of list) {
      for (const [k, m] of Object.entries(s.metrics ?? {})) {
        const mm = k.match(new RegExp(`^${prefix}\\{${tag}:([^}]+)\\}$`));
        if (mm && Number(m.values?.count ?? 0) > 0) out[mm[1]] = (out[mm[1]] ?? 0) + Number(m.values.count);
      }
    }
    return out;
  };
  const connected = byTag('rt_connected', 'b');
  const reporters = byTag('rt_reporters', 'b');
  const buckets = Object.keys({ ...connected, ...reporters }).map(Number).sort((a, b) => a - b);
  const reportSec = Number(list[0]?.meta?.reportSec ?? 10);
  return {
    target: list.reduce((a, s) => a + Number(s.meta?.conns ?? 0), 0),
    generators: list.length,
    ever: sum('rt_ever_subscribed'),
    connectRate: rate('rt_connect_ok'),
    unexpected: sum('rt_unexpected_disconnects'),
    unexpectedHold: sum('rt_unexpected_disconnects_hold'),
    byCode: byTag('rt_unexpected_disconnects', 'code'),
    noPong: sum('rt_disconnect_3012_no_pong'),
    handshake: sum('rt_handshake_errors'),
    byClass: byTag('rt_handshake_errors', 'cls'),
    p50: max('rt_delivery_latency_ms', 'med'),
    p95: max('rt_delivery_latency_ms', 'p(95)'),
    p99: max('rt_delivery_latency_ms', 'p(99)'),
    latMax: max('rt_delivery_latency_ms', 'max'),
    latCount: list.reduce((a, s) => a + val(s, 'rt_delivery_latency_ms', 'count'), 0),
    messages: sum('rt_messages_received'),
    gaps: sum('rt_offset_gaps'),
    stormCloses: sum('rt_storm_closes'),
    reconnectAttempts: sum('rt_reconnect_attempts'),
    reconnectRate: rate('rt_reconnect_ok'),
    recoveredRate: rate('rt_recovered_subscriptions'),
    recoveredPubs: sum('rt_recovered_publications'),
    reconnectP50: max('rt_time_to_reconnect_ms', 'med'),
    reconnectP99: max('rt_time_to_reconnect_ms', 'p(99)'),
    reconnectMax: max('rt_time_to_reconnect_ms', 'max'),
    reconnects: list.reduce((a, s) => a + val(s, 'rt_time_to_reconnect_ms', 'count'), 0),
    failedChecks: sum('rt_failed_checks'),
    series: buckets.map((b) => ({ atSec: b * reportSec, connected: connected[b] ?? 0, reporters: reporters[b] ?? 0 })),
  };
}

/** @param {number} v @param {[number, number]} t нижче-краще @returns {Grade} */
const lowGood = (v, t) => (v <= t[0] ? 'green' : v <= t[1] ? 'yellow' : 'red');
/** @param {number} v @param {[number, number]} t вище-краще @returns {Grade} */
const highGood = (v, t) => (v >= t[0] ? 'green' : v >= t[1] ? 'yellow' : 'red');
/** @param {Grade[]} gs @returns {Grade} */
export const worst = (gs) => (gs.includes('red') ? 'red' : gs.includes('yellow') ? 'yellow' : gs.includes('green') ? 'green' : 'n/a');
const pct = (/** @type {number} */ v) => `${(v * 100).toFixed(2)}%`;

/**
 * Пік за проміжком часу (секунди від t0) по рядках збирача.
 * @param {CollectorLine[]} lines
 * @param {number} t0Ms
 * @param {number} fromSec
 * @param {number} toSec
 * @param {(l: CollectorLine) => number} pick
 */
export function peak(lines, t0Ms, fromSec, toSec, pick) {
  let m = 0;
  for (const l of lines) {
    const at = l.ts - t0Ms / 1000;
    if (at >= fromSec && at <= toSec) m = Math.max(m, Number(pick(l)) || 0);
  }
  return m;
}

/** «123.4MiB» → МБ. @param {string} s */
export function memMb(s) {
  const m = /^([\d.]+)\s*([KMGT]?i?B)$/.exec(String(s ?? '').trim());
  if (!m) return 0;
  const k = /** @type {Record<string, number>} */ ({ B: 1 / 1048576, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024, TiB: 1048576 })[m[2]] ?? 0;
  return Number(m[1]) * k;
}

/**
 * Оцінка прогону за порогами плану §5.
 * @param {{
 *   scenario: string,
 *   sc: import('./config.mjs').Scenario,
 *   summaries: K6Summary[],
 *   publisher: K6Summary | null,
 *   collector: CollectorLine[],
 *   genCollectors: CollectorLine[][],
 *   t0Ms: number,
 *   oomKilled?: boolean,
 *   local?: boolean,
 * }} o
 */
export function evaluate(o) {
  const m = mergeSummaries(o.summaries);
  const { sc } = o;
  const total = sc.rampSec + sc.holdSec;
  const induced = sc.restart !== undefined || sc.storm !== undefined;
  /** @type {Row[]} */
  const rows = [];

  const peakConnected = m.series.reduce((a, b) => Math.max(a, b.connected), 0);
  const connectedShare = m.target ? Math.min(peakConnected, m.ever) / m.target : 0;
  rows.push({
    key: 'connected',
    title: 'Підключились',
    value: `${peakConnected} піково / ${m.ever} хоч раз / ${m.target} цільових (${pct(connectedShare)})`,
    grade: highGood(connectedShare * 100, /** @type {[number, number]} */ (THRESHOLDS.connectedPct)),
  });

  const dropsShare = m.target ? m.unexpectedHold / m.target : 0;
  rows.push({
    key: 'drops',
    title: 'Неочікувані обриви за утримання',
    value: `${m.unexpectedHold} (${pct(dropsShare)}); усього ${m.unexpected}, 3012 ${m.noPong}; коди ${JSON.stringify(m.byCode)}`,
    grade: sc.restart !== undefined ? 'n/a' : lowGood(dropsShare * 100, /** @type {[number, number]} */ (THRESHOLDS.dropsPct)),
    ...(sc.restart !== undefined ? { note: 'обриви викликані перезапуском — не оцінюються' } : {}),
  });

  const g95 = lowGood(m.p95, /** @type {[number, number]} */ (THRESHOLDS.p95Ms));
  const g99 = lowGood(m.p99, /** @type {[number, number]} */ (THRESHOLDS.p99Ms));
  rows.push({
    key: 'latency',
    title: 'Доставка p50 / p95 / p99 / макс',
    value: `${Math.round(m.p50)} / ${Math.round(m.p95)} / ${Math.round(m.p99)} / ${Math.round(m.latMax)} мс (${m.latCount} вимірів; повідомлень ${m.messages}, пропусків офсетів ${m.gaps})`,
    grade: m.latCount === 0 ? 'red' : worst([g95, g99]),
    ...(sc.fastLastSec > 0 ? { note: `включно з останніми ${sc.fastLastSec} с на ${sc.batchMs2} мс` } : {}),
  });

  if (induced) {
    const s5xx = Object.entries(m.byClass).filter(([k]) => /^s5\d\d$/.test(k)).reduce((a, [, v]) => a + v, 0);
    const mass = m.target ? (s5xx / m.target) * 100 > THRESHOLDS.mass5xxPct : false;
    const recovered = m.recoveredRate ?? 0;
    const back = m.reconnectRate ?? 0;
    const gReturn = lowGood(m.reconnectP99 / 1000, /** @type {[number, number]} */ (THRESHOLDS.returnSec));
    const gRecovered = highGood(recovered * 100, /** @type {[number, number]} */ (THRESHOLDS.recoveredPct));
    rows.push({
      key: 'return',
      title: 'Повернення після шквалу/перезапуску',
      value: `${m.reconnects} повернень (${pct(back)} епізодів), p50 ${(m.reconnectP50 / 1000).toFixed(1)} с, p99 ${(m.reconnectP99 / 1000).toFixed(1)} с, макс ${(m.reconnectMax / 1000).toFixed(1)} с; відновлено підписок ${pct(recovered)}; помилки рукостискання ${m.handshake} ${JSON.stringify(m.byClass)}`,
      grade: mass ? 'red' : worst([gReturn, gRecovered, back < 0.99 ? 'red' : 'green']),
      ...(mass ? { note: 'масові 5xx' } : {}),
    });
  }

  const hotEnd = sc.fastLastSec > 0 ? total - sc.fastLastSec : total;
  const nodeCpu = peak(o.collector, o.t0Ms, sc.rampSec, hotEnd, (l) => l.cpu_pct);
  const nodeMem = peak(o.collector, o.t0Ms, 0, total + 60, (l) => l.mem_used_mb ?? 0);
  /** @param {string} name */
  const ctr = (name) => ({
    cpu: peak(o.collector, o.t0Ms, 0, total + 60, (l) => l.containers?.find((c) => c.name === name)?.cpu_pct ?? 0),
    mem: peak(o.collector, o.t0Ms, 0, total + 60, (l) => memMb(l.containers?.find((c) => c.name === name)?.mem ?? '')),
  });
  const names = [...new Set(o.collector.flatMap((l) => (l.containers ?? []).map((c) => c.name)))].sort();
  const ctrText = names.map((n) => {
    const c = ctr(n);
    return `${n.replace(/^t2f-spike-/, '')} ${c.cpu.toFixed(0)}% / ${c.mem.toFixed(0)} МБ`;
  });
  rows.push({
    key: 'cpu',
    title: `CPU вузла (пік, утримання${sc.fastLastSec > 0 ? ` до ${sc.batchMs2} мс` : ''})`,
    value: `${nodeCpu.toFixed(1)}%, RAM ${nodeMem.toFixed(0)} МБ; контейнери (CPU — % одного ядра): ${ctrText.join(', ') || '—'}`,
    grade: o.oomKilled ? 'red' : o.collector.length ? lowGood(nodeCpu, /** @type {[number, number]} */ (THRESHOLDS.nodeCpuPct)) : 'n/a',
    ...(o.oomKilled ? { note: 'OOM' } : o.local ? { note: 'локально: CPU усієї машини Docker, не вузла c-8' } : {}),
  });

  const genCpu = o.genCollectors.map((lines) => peak(lines, o.t0Ms, 0, total + 60, (l) => l.cpu_pct));
  const unreliable = genCpu.some((c) => c > THRESHOLDS.genCpuPct);
  const pubFailed = o.publisher ? val(o.publisher, 'rt_publish_failed', 'count') : 0;
  const pubOk = o.publisher ? val(o.publisher, 'rt_published', 'count') : 0;
  const overall = worst(rows.map((r) => r.grade));
  return { merged: m, rows, overall, genCpu, unreliable, publisher: { published: pubOk, failed: pubFailed }, peakConnected };
}

/**
 * Один екран тексту.
 * @param {string} title
 * @param {ReturnType<typeof evaluate>} e
 */
export function digestLines(title, e) {
  const mark = /** @type {Record<Grade, string>} */ ({ green: 'ЗЕЛЕНИЙ', yellow: 'ЖОВТИЙ ', red: 'ЧЕРВОНИЙ', 'n/a': '—      ' });
  const lines = [title];
  for (const r of e.rows) lines.push(`  [${mark[r.grade]}] ${r.title}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
  lines.push(`  видавець: опубліковано ${e.publisher.published}, помилок ${e.publisher.failed}`);
  if (e.genCpu.length) lines.push(`  CPU генераторів (пік): ${e.genCpu.map((c) => `${c.toFixed(0)}%`).join(', ')}${e.unreliable ? ' — НЕДОСТОВІРНИЙ (генератор > 85%)' : ''}`);
  const s = e.merged.series.filter((_, i, a) => a.length <= 12 || i % Math.ceil(a.length / 12) === 0 || i === a.length - 1);
  lines.push(`  підключено в часі: ${s.map((x) => `${x.atSec}с=${x.connected}`).join(' ')}`);
  lines.push(`  ВИСНОВОК: ${mark[e.overall].trim()}${e.unreliable ? ' (недостовірний)' : ''}`);
  return lines;
}
