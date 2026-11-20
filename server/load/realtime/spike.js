/* global __ENV, __VU */
// Spike П-RT (docs/backend/spike-rt-plan.md): many sockets per VU against Centrifugo v6 (JSON protocol), auto-reconnect
// with recovery, an optional scheduled storm, sampled delivery latency and a "connected sockets over time" series.
// Runs identically on N generators: GEN_INDEX / GEN_COUNT only tag the summary. No secret is involved (anonymous connect).
//
// Env: WS_URL, CONNS (sockets on this generator), CONNS_PER_VU (50), RAMP, DURATION, CHANNELS (live:spike,site:state),
// ORIGIN, LATENCY_SAMPLE (0.1), START_AT (epoch ms of the common start; default: now), STORM_AT, STORM_WINDOW,
// RECONNECT_MIN_MS (500), RECONNECT_MAX_MS (20000), REPORT_SEC (10), SUMMARY_FILE (/out/summary.json), GEN_INDEX, GEN_COUNT.
import { WebSocket } from 'k6/websockets';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const num = (name, dflt) => (__ENV[name] !== undefined && __ENV[name] !== '' ? Number(__ENV[name]) : dflt);

/** Parses `30s`, `2m`, `1h`, `500ms` or a bare number of seconds into seconds. */
function seconds(text, dflt) {
  if (text === undefined || text === '') return dflt;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text));
  if (!m) throw new Error(`bad duration "${text}"`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 's'];
}

const cfg = {
  wsUrl: __ENV.WS_URL || 'ws://127.0.0.1:8000/connection/websocket',
  conns: num('CONNS', 100),
  perVu: Math.max(1, num('CONNS_PER_VU', 50)),
  rampSec: seconds(__ENV.RAMP, 0),
  durationSec: seconds(__ENV.DURATION, 60),
  channels: (__ENV.CHANNELS || 'live:spike,site:state').split(',').map((c) => c.trim()).filter(Boolean),
  origin: __ENV.ORIGIN || '',
  sample: num('LATENCY_SAMPLE', 0.1),
  startAt: num('START_AT', 0),
  stormAtSec: seconds(__ENV.STORM_AT, undefined),
  stormWindowSec: seconds(__ENV.STORM_WINDOW, 10),
  minMs: num('RECONNECT_MIN_MS', 500),
  maxMs: num('RECONNECT_MAX_MS', 20000),
  reportSec: num('REPORT_SEC', 10),
  summaryFile: __ENV.SUMMARY_FILE || '/out/summary.json',
  gen: num('GEN_INDEX', 0),
  genCount: num('GEN_COUNT', 1),
};
const totalSec = cfg.rampSec + cfg.durationSec;
const vus = Math.max(1, Math.ceil(cfg.conns / cfg.perVu));
/** Buckets of the connected-over-time series: one per REPORT_SEC from the start, plus a margin. */
const buckets = Math.ceil((totalSec + 60) / cfg.reportSec) + 1;

/** Close codes kept apart in the summary; anything else is tagged `other`. */
export const CLOSE_CODES = ['1000', '1001', '1005', '1006', '1011', '1012', '1013', '3000', '3001', '3002', '3003', '3004', '3005', '3006', '3007', '3008', '3010', '3011', '3012', '3501', '3502', '3503', '3504', '3505', '3506', '3507', '3508'];
/** Handshake error classes (see `errorClass`). */
export const ERROR_CLASSES = ['s400', 's401', 's403', 's404', 's429', 's500', 's502', 's503', 's504', 's520', 's521', 's522', 's523', 's524', 's525', 's526', 's530', 'sother', 'timeout', 'reset', 'refused', 'eof', 'tls', 'dns', 'bad_handshake', 'other'];

const connectOk = new Rate('rt_connect_ok');
const everSubscribed = new Counter('rt_ever_subscribed');
const reconnectOk = new Rate('rt_reconnect_ok');
const reconnectAttempts = new Counter('rt_reconnect_attempts');
const recoveredSubs = new Rate('rt_recovered_subscriptions');
const recoveredPubs = new Counter('rt_recovered_publications');
const unexpected = new Counter('rt_unexpected_disconnects');
const unexpectedHold = new Counter('rt_unexpected_disconnects_hold');
const noPong = new Counter('rt_disconnect_3012_no_pong');
const handshakeErrors = new Counter('rt_handshake_errors');
const timeToReconnect = new Trend('rt_time_to_reconnect_ms', true);
const delivery = new Trend('rt_delivery_latency_ms', true);
const received = new Counter('rt_messages_received');
const offsetGaps = new Counter('rt_offset_gaps');
const failedChecks = new Counter('rt_failed_checks');
const stormCloses = new Counter('rt_storm_closes');
const connectedSeries = new Counter('rt_connected');
const reporters = new Counter('rt_reporters');

/** Zero-valued thresholds make tagged submetrics appear in the summary (they always pass). */
const thresholds = {};
for (let b = 0; b < buckets; b++) {
  thresholds[`rt_connected{b:${b}}`] = ['count>=0'];
  thresholds[`rt_reporters{b:${b}}`] = ['count>=0'];
}
for (const c of [...CLOSE_CODES, 'other']) thresholds[`rt_unexpected_disconnects{code:${c}}`] = ['count>=0'];
for (const c of ERROR_CLASSES) thresholds[`rt_handshake_errors{cls:${c}}`] = ['count>=0'];

export const options = {
  setupTimeout: '30m',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'p(99.9)', 'max', 'count'],
  scenarios: {
    sockets: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: `${Math.ceil(totalSec + 120)}s` },
  },
  thresholds,
};

/**
 * Short class of a k6 websocket error text: an HTTP status when the text carries one, otherwise the transport cause.
 * @param {string} text
 */
export function errorClass(text) {
  const s = String(text || '').toLowerCase();
  const status = /\b(?:status(?: code)?|got|response)[^0-9]{0,12}([1-5]\d\d)\b/.exec(s) || /\b([45]\d\d)\b/.exec(s);
  if (status) {
    const code = `s${status[1]}`;
    return ERROR_CLASSES.includes(code) ? code : 'sother';
  }
  if (/timeout|timed out|deadline/.test(s)) return 'timeout';
  if (/reset by peer|connection reset|broken pipe/.test(s)) return 'reset';
  if (/refused/.test(s)) return 'refused';
  if (/\beof\b/.test(s)) return 'eof';
  if (/tls|x509|certificate/.test(s)) return 'tls';
  if (/no such host|lookup|dns/.test(s)) return 'dns';
  if (/bad handshake/.test(s)) return 'bad_handshake';
  return 'other';
}

/** centrifuge-js-like backoff: exponential cap from min to max, full jitter, never below min. */
function backoffMs(attempt) {
  const cap = Math.min(cfg.maxMs, cfg.minMs * Math.pow(2, attempt));
  return Math.max(cfg.minMs, Math.floor(Math.random() * cap));
}

/** Waits until the common start (all generators and the publisher align their ramps on START_AT). */
export function setup() {
  const t0 = cfg.startAt > 0 ? cfg.startAt : Date.now();
  const wait = (t0 - Date.now()) / 1000;
  if (wait > 0) sleep(wait);
  return { t0 };
}

export default function (data) {
  const t0 = data.t0;
  const at = (sec) => t0 + sec * 1000;
  const holdStart = at(cfg.rampSec);
  const holdEnd = at(totalSec);
  const first = (__VU - 1) * cfg.perVu;
  const count = Math.max(0, Math.min(cfg.perVu, cfg.conns - first));
  const sockets = [];
  let liveCount = 0;
  let pendingMsgs = 0;
  let finished = false;

  const sock = (idx) => ({
    idx,
    sampled: Math.random() < cfg.sample,
    ws: null,
    state: 'idle', // idle | connecting | subscribed | closed
    attempt: 0,
    everSubscribed: false,
    episodeStart: 0, // close moment of an unexpected/storm close; 0 when not reconnecting
    recovering: false,
    noBackoff: false,
    epochs: {}, // channel -> { epoch, offset }
    gen: 0, // connection generation: callbacks of an old socket are ignored
  });

  const schedule = (s, delayMs) => {
    setTimeout(() => {
      if (!finished) open(s);
    }, Math.max(0, delayMs));
  };

  /** One connection attempt. */
  function open(s) {
    s.gen += 1;
    const gen = s.gen;
    s.state = 'connecting';
    let opened = false;
    let subscribed = false;
    let closedHandled = false;
    let pendingSubs = 0;
    let nextId = 1;
    const subIds = {};
    const reconnect = s.episodeStart > 0;
    if (reconnect) reconnectAttempts.add(1);
    const ws = new WebSocket(cfg.wsUrl, null, cfg.origin ? { headers: { Origin: cfg.origin } } : undefined);
    s.ws = ws;

    const onSubscribed = () => {
      subscribed = true;
      s.state = 'subscribed';
      liveCount += 1;
      if (!s.everSubscribed) {
        s.everSubscribed = true;
        everSubscribed.add(1);
        connectOk.add(true); // once per socket: subscribed at least once (false at the end otherwise)
      }
      if (reconnect) {
        timeToReconnect.add(Date.now() - s.episodeStart);
        reconnectOk.add(true);
        s.episodeStart = 0;
      }
      s.attempt = 0;
    };

    const finish = (code, errorText) => {
      if (closedHandled || gen !== s.gen) return;
      closedHandled = true;
      if (subscribed) liveCount -= 1;
      const now = Date.now();
      const ours = s.state === 'closing' || finished || now >= holdEnd;
      s.state = 'closed';
      if (!opened) handshakeErrors.add(1, { cls: errorClass(errorText) });
      if (ours) {
        if (s.noBackoff && !finished && now < holdEnd) {
          // Storm: reconnect at once, asking for recovery.
          s.noBackoff = false;
          s.episodeStart = s.episodeStart || now;
          s.attempt = 0;
          open(s);
        }
        return;
      }
      if (opened && subscribed) {
        const tag = CLOSE_CODES.includes(String(code)) ? String(code) : 'other';
        unexpected.add(1, { code: tag });
        if (now >= holdStart) unexpectedHold.add(1);
        if (code === 3012) noPong.add(1);
      }
      if (s.episodeStart === 0) s.episodeStart = now;
      const delay = backoffMs(s.attempt);
      s.attempt += 1;
      schedule(s, delay);
    };

    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.onopen = () => {
      if (gen !== s.gen) return;
      opened = true;
      send({ id: nextId++, connect: { name: 'k6-spike' } });
    };

    const onReply = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        failedChecks.add(1);
        return;
      }
      if (msg.connect !== undefined || (msg.id === 1 && msg.error)) {
        if (msg.error) {
          failedChecks.add(1);
          ws.close();
          return;
        }
        pendingSubs = cfg.channels.length;
        for (const channel of cfg.channels) {
          const id = nextId++;
          subIds[id] = channel;
          const sub = { channel };
          const prev = s.epochs[channel];
          if (prev) {
            sub.recover = true;
            sub.epoch = prev.epoch;
            sub.offset = prev.offset;
          }
          send({ id, subscribe: sub });
        }
        return;
      }
      if (msg.id !== undefined && subIds[msg.id] !== undefined) {
        const channel = subIds[msg.id];
        if (msg.error) {
          failedChecks.add(1);
          return;
        }
        const r = msg.subscribe || {};
        const prev = s.epochs[channel];
        if (prev) recoveredSubs.add(r.recovered === true && r.epoch === prev.epoch);
        if (Array.isArray(r.publications) && r.publications.length) {
          recoveredPubs.add(r.publications.length);
          pendingMsgs += r.publications.length;
        }
        if (r.recoverable) {
          let offset = r.offset || 0;
          if (Array.isArray(r.publications)) for (const p of r.publications) if (p.offset > offset) offset = p.offset;
          s.epochs[channel] = { epoch: r.epoch, offset };
        }
        pendingSubs -= 1;
        if (pendingSubs === 0) onSubscribed();
        return;
      }
    };

    /** A publication push: cheap string work only, unless this socket is sampled for latency. */
    const onPush = (line) => {
      const pubAt = line.indexOf('"pub":');
      if (pubAt === -1) {
        onReply(line);
        return;
      }
      pendingMsgs += 1;
      const chStart = line.indexOf('"channel":"');
      const channel = chStart === -1 ? '' : line.slice(chStart + 11, line.indexOf('"', chStart + 11));
      const oAt = line.lastIndexOf('"offset":');
      const st = s.epochs[channel];
      if (oAt !== -1 && st) {
        const offset = parseInt(line.slice(oAt + 9, oAt + 30), 10);
        if (offset > st.offset + 1) offsetGaps.add(offset - st.offset - 1);
        if (offset > st.offset) st.offset = offset;
      }
      if (s.sampled) {
        try {
          const msg = JSON.parse(line);
          const t = msg.push.pub.data && msg.push.pub.data.t;
          if (typeof t === 'number') delivery.add(Date.now() - t);
        } catch {
          failedChecks.add(1);
        }
      }
    };

    const onLine = (line) => {
      if (line === '{}') {
        ws.send('{}'); // server ping -> pong
      } else if (line.startsWith('{"push":')) {
        onPush(line);
      } else {
        onReply(line);
      }
    };

    ws.onmessage = (event) => {
      if (gen !== s.gen) return;
      const data = String(event.data);
      if (data.indexOf('\n') === -1) {
        onLine(data);
        return;
      }
      for (const line of data.split('\n')) if (line !== '') onLine(line);
    };

    ws.onerror = (event) => {
      if (opened || gen !== s.gen) return;
      // A failed handshake: some k6 versions fire no close event after it, so finish here (once).
      finish(0, event && event.error);
    };

    ws.onclose = (event) => finish(event ? event.code : 0, '');
  }

  // Periodic report aligned on t0: connected sockets of this VU (summed over VUs per bucket) and message counts.
  const report = () => {
    const b = Math.round((Date.now() - t0) / (cfg.reportSec * 1000));
    if (b >= 0 && b < buckets) {
      connectedSeries.add(liveCount, { b: String(b) });
      reporters.add(1, { b: String(b) });
    }
    if (pendingMsgs) {
      received.add(pendingMsgs);
      pendingMsgs = 0;
    }
  };
  const firstReport = cfg.reportSec * 1000 - ((Date.now() - t0) % (cfg.reportSec * 1000));
  let ticker = null;
  setTimeout(() => {
    if (finished) return; // the hold already ended: no ticker left behind to keep the VU alive
    report();
    ticker = setInterval(report, cfg.reportSec * 1000);
  }, firstReport);

  for (let j = 0; j < count; j++) {
    const s = sock(first + j);
    sockets.push(s);
    const openAt = at(cfg.conns > 1 ? (s.idx / cfg.conns) * cfg.rampSec : 0);
    schedule(s, openAt - Date.now());
    if (cfg.stormAtSec !== undefined) {
      const stormAt = at(cfg.stormAtSec + Math.random() * cfg.stormWindowSec);
      setTimeout(() => {
        if (s.state !== 'subscribed' && s.state !== 'connecting') return;
        stormCloses.add(1);
        s.noBackoff = true;
        s.episodeStart = Date.now();
        s.state = 'closing';
        try {
          s.ws.close();
        } catch {
          /* not open yet: the close event still settles it */
        }
      }, stormAt - Date.now());
    }
  }

  // End of hold: close everything, settle unfinished reconnect episodes, stop the ticker.
  setTimeout(() => {
    finished = true;
    report();
    for (const s of sockets) {
      if (s.episodeStart > 0) reconnectOk.add(false);
      if (!s.everSubscribed) connectOk.add(false);
      if (s.state === 'subscribed' || s.state === 'connecting') {
        s.state = 'closing';
        try {
          s.ws.close();
        } catch {
          /* already closed */
        }
      }
    }
    if (pendingMsgs) received.add(pendingMsgs);
    pendingMsgs = 0;
    if (ticker !== null) clearInterval(ticker);
  }, holdEnd - Date.now());
}

const metricValue = (data, name, field) => {
  const m = data.metrics[name];
  return m && m.values && m.values[field] !== undefined ? m.values[field] : 0;
};

export function handleSummary(data) {
  const meta = {
    gen: cfg.gen,
    genCount: cfg.genCount,
    conns: cfg.conns,
    perVu: cfg.perVu,
    vus,
    rampSec: cfg.rampSec,
    durationSec: cfg.durationSec,
    reportSec: cfg.reportSec,
    t0: data.setup_data ? data.setup_data.t0 : null,
    stormAtSec: cfg.stormAtSec === undefined ? null : cfg.stormAtSec,
    stormWindowSec: cfg.stormWindowSec,
    channels: cfg.channels,
  };
  const lat = (f) => Math.round(metricValue(data, 'rt_delivery_latency_ms', f));
  const lines = [
    `spike gen ${cfg.gen}/${cfg.genCount}: target ${cfg.conns}, ever subscribed ${metricValue(data, 'rt_ever_subscribed', 'count')}`,
    `  connect ok ${(metricValue(data, 'rt_connect_ok', 'rate') * 100).toFixed(2)}%, unexpected disconnects ${metricValue(data, 'rt_unexpected_disconnects', 'count')} (hold ${metricValue(data, 'rt_unexpected_disconnects_hold', 'count')}), handshake errors ${metricValue(data, 'rt_handshake_errors', 'count')}`,
    `  delivery p50 ${lat('med')} ms, p95 ${lat('p(95)')} ms, p99 ${lat('p(99)')} ms, max ${lat('max')} ms; messages ${metricValue(data, 'rt_messages_received', 'count')}, offset gaps ${metricValue(data, 'rt_offset_gaps', 'count')}`,
    `  reconnects ${metricValue(data, 'rt_reconnect_attempts', 'count')} attempts, ok ${(metricValue(data, 'rt_reconnect_ok', 'rate') * 100).toFixed(2)}%, recovered ${(metricValue(data, 'rt_recovered_subscriptions', 'rate') * 100).toFixed(2)}%, time p99 ${Math.round(metricValue(data, 'rt_time_to_reconnect_ms', 'p(99)'))} ms`,
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    [cfg.summaryFile]: JSON.stringify({ meta, metrics: data.metrics, state: data.state }),
  };
}
