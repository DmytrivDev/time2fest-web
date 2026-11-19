// @ts-check
/**
 * Night-run driver (SPEC-07 W42; AC-27, AC-31, AC-32, NFR-5): proves "every (moment, action) of a
 * run epoch exactly once, in the C1 order" over a whole virtual night, and measures how late each
 * action started in REAL milliseconds.
 *
 *   node scripts/night-run.mjs --server http://127.0.0.1:<port> [--speed 60] [--from <ISO|ms>] [--to <ISO|ms>] [--timeout-min <n>]
 *   node scripts/night-run.mjs --rehearsal-records <file.json> [--speed 60]
 *   node scripts/night-run.mjs --help
 *
 * Server mode (a running worktree server of class `test` with `T2F_TEST_DOORS=1`, loopback only):
 * `POST /api/_test/scheduler/night-run` (new run epoch, clock at `from`, default celebration-start −
 * 60 s), polls `GET /api/_test/scheduler/night-run` until `rating-close` is recorded (or the clock
 * passed `--to`), freezes the clock, analyses the records of the epoch. Deviation = real start of the
 * action − real due instant (from the clock read right after the start). Rehearsal mode analyses the
 * output of `pnpm run clock records` (records carry the server instant `at`): deviation =
 * (at − plannedAt) ÷ speed.
 *
 * Checks (the run recorder runs one action for all 11 kinds, one call per instant):
 * - duplicates: a (action, moment key) recorded more than once;
 * - order: records not in non-decreasing planned instant, or keys inside one call not in C1 tie order
 *   (rank: handover/pin-end, zone-midnight, event-stamp, the rest; keys ascending within a rank,
 *   except event-stamps, which follow the catalog order); split: two calls of one action at one instant;
 * - missed: every zone of the catalog (`GET /api/catalog`, server mode) and every subject seen has
 *   all four of its moments, and the three season moments exist, for every instant up to the stop.
 * Prints `T2F_MEASURE {"metric":"moment-deviation-ms",…}` and one line
 * `NIGHT_RUN ok|fail moments=<n> pairs=<n> duplicates=<n> missed=<n> order_violations=<n> split=<n> [reason=…]`.
 * Exit 0 ok, 1 fail, 2 usage or I/O error. Prints no secret (the doors need none).
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIN = 60_000;
const HOUR = 60 * MIN;
const POLL_MS = 2_000;
const DEVIATION_P99_MAX_MS = 1_000;
/** Tie rank at one instant (C1, `seasonMoments`). */
const RANK = /** @type {Record<string, number>} */ ({
  'event-handover': 1,
  'pin-end': 1,
  'zone-midnight': 2,
  'event-stamp': 3,
});
const ZONE_KINDS = ['poll-start', 'poll-end', 'zone-midnight', 'pin-end'];
const EVENT_KINDS = ['event-reminder', 'event-moment', 'event-stamp', 'event-handover'];
const SEASON_KINDS = ['celebration-start', 'celebration-end', 'rating-close'];

const USAGE = [
  'usage: node scripts/night-run.mjs --server http://127.0.0.1:<port> [--speed 1..600] [--from <ISO|ms>] [--to <ISO|ms>] [--timeout-min <n>]',
  '       node scripts/night-run.mjs --rehearsal-records <file.json> [--speed 1..600]',
].join('\n');

/**
 * @typedef {{ keys: string[], action: string, plannedAt: number, startedAt: number, at?: number, consequenceId: string }} NightRecord
 * @typedef {{ server?: string, records?: string, speed: number, from?: number, to?: number, timeoutMin?: number, help: boolean }} NightArgs
 */

/** @param {string} v */
function instant(v) {
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * @param {string[]} argv
 * @returns {NightArgs | { error: string }}
 */
export function parseNightArgs(argv) {
  /** @type {NightArgs} */
  const out = { speed: 60, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined) return { error: `${a} needs a value` };
    i += 1;
    if (a === '--server') {
      let url;
      try {
        url = new URL(v);
      } catch {
        return { error: '--server is not a URL' };
      }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return { error: '--server must be http:// on loopback' };
      out.server = url.origin;
    } else if (a === '--rehearsal-records') out.records = v;
    else if (a === '--speed') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 600) return { error: '--speed must be an integer 1..600' };
      out.speed = n;
    } else if (a === '--from' || a === '--to') {
      const t = instant(v);
      if (t === undefined) return { error: `${a} must be an ISO instant or epoch ms` };
      if (a === '--from') out.from = t;
      else out.to = t;
    } else if (a === '--timeout-min') {
      const n = Number(v);
      if (!(n > 0)) return { error: '--timeout-min must be positive' };
      out.timeoutMin = n;
    } else return { error: `unknown argument ${a}` };
  }
  if (!out.help && (out.server === undefined) === (out.records === undefined)) return { error: 'give exactly one of --server or --rehearsal-records' };
  if (out.from !== undefined && out.to !== undefined && out.to <= out.from) return { error: '--to must be after --from' };
  return out;
}

/** @param {string} key */
const kindOf = (key) => key.slice(0, Math.max(0, key.indexOf(':')));
/** @param {string} key */
const subjectOf = (key) => key.slice(key.indexOf(':') + 1);
/** @param {string} key */
const rankOf = (key) => RANK[kindOf(key)] ?? 4;

/**
 * Nearest-rank percentile of sorted values.
 * @param {number[]} sorted @param {number} q
 */
function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length))) - 1] ?? 0;
}

/**
 * @param {string} metric @param {number[]} values
 * @returns {{ metric: string, n: number, p50: number, p99: number, max: number }}
 */
export function summarize(metric, values) {
  const s = [...values].sort((a, b) => a - b);
  const r = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  return { metric, n: s.length, p50: r(percentile(s, 0.5)), p99: r(percentile(s, 0.99)), max: r(s.at(-1) ?? 0) };
}

/**
 * The checks over records in execution order, up to `stopAt` (planned instant).
 * @param {NightRecord[]} all
 * @param {{ stopAt: number, zoneMidnights?: Map<string, number> }} opts
 */
export function analyse(all, { stopAt, zoneMidnights = new Map() }) {
  const records = all.filter((r) => r.plannedAt <= stopAt);
  /** @type {Map<string, number>} */
  const pairCount = new Map();
  /** @type {Map<string, Map<string, number>>} kind → subject → planned */
  const seen = new Map();
  let orderViolations = 0;
  let split = 0;
  let prevAt = -Infinity;
  /** @type {Set<string>} */
  const calls = new Set();
  for (const r of records) {
    if (r.plannedAt < prevAt) orderViolations += 1;
    prevAt = Math.max(prevAt, r.plannedAt);
    const call = `${r.action}@${r.plannedAt}`;
    if (calls.has(call)) split += 1;
    calls.add(call);
    for (let i = 0; i < r.keys.length; i += 1) {
      const k = r.keys[i] ?? '';
      const pair = `${r.action}|${k}`;
      pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
      const kind = kindOf(k);
      if (!seen.has(kind)) seen.set(kind, new Map());
      seen.get(kind)?.set(subjectOf(k), r.plannedAt);
      if (i === 0) continue;
      const prev = r.keys[i - 1] ?? '';
      const [ra, rb] = [rankOf(prev), rankOf(k)];
      if (rb < ra) orderViolations += 1;
      else if (rb === ra && rb !== 3 && k < prev) orderViolations += 1;
    }
  }
  const has = (/** @type {string} */ kind, /** @type {string} */ subject) => seen.get(kind)?.has(subject) === true;
  /** @type {string[]} */
  const missed = [];
  // Zones: from the catalog and from any zone key seen; instants from the zone midnight.
  const zones = new Map(zoneMidnights);
  for (const kind of ZONE_KINDS) {
    for (const [subject, planned] of seen.get(kind) ?? []) {
      if (zones.has(subject)) continue;
      const offset = kind === 'poll-start' ? -HOUR : kind === 'poll-end' ? HOUR : 0;
      zones.set(subject, planned - offset);
    }
  }
  for (const [zone, m] of zones) {
    const due = { 'poll-start': m - HOUR, 'pin-end': m, 'zone-midnight': m, 'poll-end': m + HOUR };
    for (const kind of ZONE_KINDS) if (due[/** @type {keyof typeof due} */ (kind)] <= stopAt && !has(kind, zone)) missed.push(`${kind}:${zone}`);
  }
  // Events: every subject seen in any event kind has the four, timed from whichever was seen.
  /** @type {Map<string, number>} */
  const events = new Map();
  const eventOffset = /** @type {Record<string, number>} */ ({ 'event-reminder': -15 * MIN, 'event-moment': 0, 'event-stamp': 15_000, 'event-handover': 15 * MIN });
  for (const kind of EVENT_KINDS) for (const [subject, planned] of seen.get(kind) ?? []) if (!events.has(subject)) events.set(subject, planned - (eventOffset[kind] ?? 0));
  for (const [event, m] of events) for (const kind of EVENT_KINDS) if (m + (eventOffset[kind] ?? 0) <= stopAt && !has(kind, event)) missed.push(`${kind}:${event}`);
  // Season: from the zone midnights.
  const mids = [...zones.values()];
  if (mids.length > 0) {
    const first = Math.min(...mids);
    const last = Math.max(...mids);
    const due = { 'celebration-start': first - 2 * HOUR, 'celebration-end': last + 2 * HOUR, 'rating-close': last + 12 * HOUR };
    for (const kind of SEASON_KINDS) if (due[/** @type {keyof typeof due} */ (kind)] <= stopAt && (seen.get(kind)?.size ?? 0) !== 1) missed.push(kind);
  }
  const duplicates = [...pairCount.values()].filter((n) => n > 1).length;
  const moments = new Set(records.flatMap((r) => r.keys)).size;
  return { records, moments, pairs: pairCount.size, duplicates, missed, orderViolations, split };
}

/**
 * @param {ReturnType<typeof analyse>} a @param {{ p99: number, n: number }} dev
 */
export function verdict(a, dev) {
  /** @type {string[]} */
  const reasons = [];
  if (a.records.length === 0) reasons.push('no-records');
  if (a.duplicates > 0) reasons.push('duplicates');
  if (a.missed.length > 0) reasons.push('missed');
  if (a.orderViolations > 0) reasons.push('order');
  if (a.split > 0) reasons.push('split');
  if (dev.n > 0 && dev.p99 > DEVIATION_P99_MAX_MS) reasons.push('deviation-p99-over-1000ms');
  const head = `NIGHT_RUN ${reasons.length === 0 ? 'ok' : 'fail'} moments=${a.moments} pairs=${a.pairs} duplicates=${a.duplicates} missed=${a.missed.length} order_violations=${a.orderViolations} split=${a.split}`;
  return { ok: reasons.length === 0, line: reasons.length === 0 ? head : `${head} reason=${reasons.join(',')}` };
}

// ---- server mode ----------------------------------------------------------------------------------

/**
 * @param {string} base @param {string} path @param {unknown} [body]
 * @returns {Promise<any>}
 */
async function door(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = /** @type {{ ok?: boolean, value?: unknown }} */ (await res.json().catch(() => ({})));
  if (!res.ok) throw new Error(`${body === undefined ? 'GET' : 'POST'} ${path} → HTTP ${res.status}`);
  return json.value;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {number} t */
const iso = (t) => new Date(t).toISOString();

/** @param {NightArgs & { server: string }} args @param {(s: string) => void} out */
async function runServer(args, out) {
  const base = args.server;
  /** @type {Map<string, number>} */
  const zoneMidnights = new Map();
  try {
    const catalog = await door(base, '/api/catalog');
    for (const z of catalog?.schedule?.zones ?? []) {
      const m = Date.parse(z.midnightUtc);
      if (typeof z.id === 'string' && Number.isFinite(m)) zoneMidnights.set(z.id, m);
    }
  } catch {
    out('night-run: GET /api/catalog failed — zones are checked from the records only');
  }

  const body = { speed: args.speed, ...(args.from !== undefined ? { from: args.from } : {}), ...(args.to !== undefined ? { to: args.to } : {}) };
  const { epoch } = await door(base, '/api/_test/scheduler/night-run', body);
  const r0 = Date.now();
  const clock = await door(base, '/api/_test/clock');
  const r1 = Date.now();
  // The clock read is the anchor: server instant `v0` at real instant `real0` (RTT/2 error).
  const real0 = (r0 + r1) / 2;
  const v0 = Number(clock?.now);
  if (!Number.isFinite(v0) || clock?.speed !== args.speed) throw new Error('the clock did not take the night-run');
  const serverNow = () => v0 + (Date.now() - real0) * args.speed;
  out(`night-run: epoch ${epoch} from ${iso(v0)} at ×${args.speed}${args.to !== undefined ? ` to ${iso(args.to)}` : ' to rating-close'}`);

  const timeoutMs = (args.timeoutMin ?? (args.to !== undefined ? (args.to - v0) / args.speed / MIN + 5 : 60)) * MIN;
  const deadline = Date.now() + timeoutMs;
  /** @type {NightRecord[]} */
  let records = [];
  let lastNote = 0;
  let lastCount = -1;
  for (;;) {
    await sleep(POLL_MS);
    records = (await door(base, '/api/_test/scheduler/night-run'))?.records ?? [];
    const now = serverNow();
    const to = args.to;
    const done =
      to !== undefined
        ? // Past `to`, and the records up to it are in: a later one exists, or a poll brought nothing new.
          now >= to && (records.some((r) => r.plannedAt > to) || records.length === lastCount)
        : records.some((r) => r.keys.some((k) => k.startsWith('rating-close:')));
    lastCount = records.length;
    if (done) break;
    if (Date.now() - lastNote >= 30_000) {
      lastNote = Date.now();
      out(`night-run: server ${iso(now)} records=${records.length}`);
    }
    if (Date.now() > deadline) {
      out(`night-run: timed out after ${Math.round(timeoutMs / MIN)} min at server ${iso(now)}`);
      break;
    }
  }
  await door(base, '/api/_test/clock', { frozen: true }).catch(() => out('night-run: could not freeze the clock'));
  const stopAt = args.to ?? Math.max(...records.map((r) => r.plannedAt), v0);
  const a = analyse(records, { stopAt, zoneMidnights });
  // A `--from` after celebration-start makes every earlier moment due at once: moments that fall
  // due while that backlog still runs are not measured (AC-32 is "without load").
  const backlogEnd = Math.max(-Infinity, ...a.records.filter((r) => r.plannedAt < v0).map((r) => r.startedAt));
  const measured = a.records
    .filter((r) => r.plannedAt >= v0)
    .map((r) => ({ r, due: real0 + (r.plannedAt - v0) / args.speed }))
    .filter((x) => x.due >= backlogEnd)
    .map(({ r, due }) => ({ r, dev: r.startedAt - due }));
  const worst = [...measured].sort((x, y) => y.dev - x.dev).slice(0, 5);
  const skipped = a.records.filter((r) => r.plannedAt >= v0).length - measured.length;
  out(`night-run: anchor read in ${r1 - r0} ms; ${skipped} moments due during the start backlog not measured; worst: ${worst.map((w) => `${iso(w.r.plannedAt)} (${w.r.keys.length} keys)=${Math.round(w.dev)}ms`).join(', ')}`);
  return { a, devs: measured.map((m) => m.dev) };
}

// ---- rehearsal mode -------------------------------------------------------------------------------

/** @param {NightArgs & { records: string }} args */
function runRehearsal(args) {
  /** @type {{ epoch?: number, records?: NightRecord[] }} */
  const parsed = JSON.parse(fs.readFileSync(args.records, 'utf8'));
  const records = [...(parsed.records ?? [])].sort((x, y) => x.startedAt - y.startedAt);
  const stopAt = Math.max(...records.map((r) => r.plannedAt));
  const a = analyse(records, { stopAt });
  const devs = a.records.filter((r) => typeof r.at === 'number').map((r) => ((r.at ?? r.plannedAt) - r.plannedAt) / args.speed);
  return { a, devs };
}

// ---- main -----------------------------------------------------------------------------------------

/** @param {string[]} argv @param {(s: string) => void} out */
export async function main(argv, out = (s) => process.stdout.write(`${s}\n`)) {
  const args = parseNightArgs(argv);
  if ('error' in args) {
    out(`${args.error}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }
  let result;
  try {
    result = args.server !== undefined ? await runServer({ ...args, server: args.server }, out) : runRehearsal({ ...args, records: args.records ?? '' });
  } catch (err) {
    out(`night-run: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const dev = summarize('moment-deviation-ms', result.devs);
  out(`T2F_MEASURE ${JSON.stringify(dev)}`);
  if (result.a.missed.length > 0) out(`night-run: missed ${result.a.missed.slice(0, 20).join(' ')}${result.a.missed.length > 20 ? ' …' : ''}`);
  const v = verdict(result.a, dev);
  out(v.line);
  return v.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
