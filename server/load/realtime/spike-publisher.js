/* global __ENV */
// Spike П-RT publisher: runs on the realtime node inside its Docker network against the internal API
// (`http://centrifugo:9000`, X-API-Key from env API_KEY or CENTRIFUGO_HTTP_API_KEY of centrifugo.env — never in argv). Publishes the room batch to `live:spike`
// (PAYLOAD_BYTES of JSON: {t, msgs:[…], reactions:{…}}) every BATCH_MS, switching to BATCH_MS_2 for the last FAST_LAST
// seconds, and `site:state` every 30 s. `t` is the publisher clock: subscribers measure delivery latency against it.
//
// Env: API_URL (http://centrifugo:9000), API_KEY, LIVE_CHANNEL (live:spike), STATE_CHANNEL (site:state), START_AT (epoch
// ms of the common start), DELAY (seconds after START_AT before publishing; usually the ramp), DURATION (publishing time),
// BATCH_MS (500), BATCH_MS_2 (250), FAST_LAST (seconds; 0 = no switch), PAYLOAD_BYTES (1000), SUMMARY_FILE.
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const num = (name, dflt) => (__ENV[name] !== undefined && __ENV[name] !== '' ? Number(__ENV[name]) : dflt);
function seconds(text, dflt) {
  if (text === undefined || text === '') return dflt;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text));
  if (!m) throw new Error(`bad duration "${text}"`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 's'];
}

const cfg = {
  apiUrl: (__ENV.API_URL || 'http://centrifugo:9000').replace(/\/+$/, ''),
  live: __ENV.LIVE_CHANNEL || 'live:spike',
  state: __ENV.STATE_CHANNEL || 'site:state',
  startAt: num('START_AT', 0),
  delaySec: seconds(__ENV.DELAY, 0),
  durationSec: seconds(__ENV.DURATION, 60),
  batchMs: num('BATCH_MS', 500),
  batchMs2: num('BATCH_MS_2', 250),
  fastLastSec: seconds(__ENV.FAST_LAST, 0),
  payloadBytes: num('PAYLOAD_BYTES', 1000),
  summaryFile: __ENV.SUMMARY_FILE || '/out/publisher-summary.json',
};
const slowSec = Math.max(0, cfg.durationSec - cfg.fastLastSec);
const fastSec = cfg.durationSec - slowSec;

const published = new Counter('rt_published');
const failed = new Counter('rt_publish_failed');
const publishMs = new Trend('rt_publish_ms', true);

const scenarios = {
  state: {
    executor: 'constant-arrival-rate',
    exec: 'publishState',
    rate: 1,
    timeUnit: '30s',
    duration: `${Math.max(1, Math.ceil(cfg.durationSec))}s`,
    startTime: `${cfg.delaySec}s`,
    preAllocatedVUs: 1,
    maxVUs: 2,
  },
};
if (slowSec > 0) {
  scenarios.batch = {
    executor: 'constant-arrival-rate',
    exec: 'publishBatch',
    rate: 1,
    timeUnit: `${cfg.batchMs}ms`,
    duration: `${Math.ceil(slowSec)}s`,
    startTime: `${cfg.delaySec}s`,
    preAllocatedVUs: 4,
    maxVUs: 20,
  };
}
if (fastSec > 0) {
  scenarios.batchFast = {
    executor: 'constant-arrival-rate',
    exec: 'publishBatch',
    rate: 1,
    timeUnit: `${cfg.batchMs2}ms`,
    duration: `${Math.ceil(fastSec)}s`,
    startTime: `${cfg.delaySec + Math.ceil(slowSec)}s`,
    preAllocatedVUs: 4,
    maxVUs: 20,
  };
}

export const options = {
  setupTimeout: '30m',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios,
  thresholds: { rt_publish_failed: ['count==0'] },
};

/** A room batch: ~8 chat messages and aggregated reaction counters, padded to PAYLOAD_BYTES of JSON. */
function batchTemplate(bytes) {
  const msgs = [];
  for (let i = 0; i < 8; i++) msgs.push({ id: `m${i}`, u: `Guest ${1000 + i}`, f: 'UA', x: 'Happy New Year!' });
  const body = { t: 0, msgs, reactions: { fire: 12, heart: 30, clap: 7, party: 21 }, pad: '' };
  const base = JSON.stringify(body).length + 12; // `t` grows to 13 digits
  body.pad = 'x'.repeat(Math.max(0, bytes - base));
  return body;
}
const template = batchTemplate(cfg.payloadBytes);

export function setup() {
  const t0 = cfg.startAt > 0 ? cfg.startAt : Date.now();
  const wait = (t0 - Date.now()) / 1000;
  if (wait > 0) sleep(wait);
  return { t0 };
}

function publish(channel, data) {
  const res = http.post(`${cfg.apiUrl}/api/publish`, JSON.stringify({ channel, data }), {
    headers: { 'Content-Type': 'application/json', 'X-API-Key': __ENV.API_KEY || __ENV.CENTRIFUGO_HTTP_API_KEY || '' },
    timeout: '10s',
  });
  let ok = res.status === 200;
  if (ok) {
    try {
      ok = !(res.json() || {}).error;
    } catch {
      ok = false;
    }
  }
  publishMs.add(res.timings.duration);
  if (ok) published.add(1, { channel });
  else failed.add(1, { channel });
}

export function publishBatch() {
  template.t = Date.now();
  publish(cfg.live, template);
}

export function publishState() {
  publish(cfg.state, { t: Date.now(), state: 'spike' });
}

export function handleSummary(data) {
  const v = (n, f) => (data.metrics[n] && data.metrics[n].values[f]) || 0;
  return {
    stdout: `spike publisher: published ${v('rt_published', 'count')}, failed ${v('rt_publish_failed', 'count')}, publish p95 ${Math.round(v('rt_publish_ms', 'p(95)'))} ms\n`,
    [cfg.summaryFile]: JSON.stringify({ meta: { batchMs: cfg.batchMs, batchMs2: cfg.batchMs2, fastLastSec: cfg.fastLastSec, payloadBytes: cfg.payloadBytes, t0: data.setup_data ? data.setup_data.t0 : null }, metrics: data.metrics }),
  };
}
