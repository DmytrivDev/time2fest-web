/* global __ENV, open */
// SPEC-14 NFR-2: stamp claims `POST /api/me/stamps` at a constant arrival rate (default 100/s, 60 s) from the guest
// subjects the runner prepared (each already beat inside the window, so every claim is a grant or the existing
// stamp), with the server clock frozen just after the stamp moment. Pass: p95 ≤ 100 ms, no failed request, every
// answer 200 with the stamp of the event. Subjects round robin keep each under the 60-a-minute row.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

/** Requests that got no HTTP answer at all (status 0: connection dropped before the server saw them). */
export const transportErrors = new Counter('presence_transport_errors');

const seconds = (text, dflt) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text || '');
  if (!m) return dflt;
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2] || 's'];
};
const apiUrl = (__ENV.API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const hostHeader = __ENV.HOST_HEADER || '';
const origin = __ENV.ORIGIN || 'http://localhost:3000';
const eventId = __ENV.EVENT_ID || '';
const at = Number(__ENV.CLAIM_AT || '0');
const durationSec = seconds(__ENV.DURATION, 60);
const [rateN, rateUnit] = (__ENV.RATE || '100/s').split('/');
const timeUnit = { s: '1s', sec: '1s', min: '1m', m: '1m', h: '1h' }[rateUnit || 's'] || '1s';
const subjects = JSON.parse(open(__ENV.SUBJECTS_FILE || '/data/subjects.json'));

export const options = {
  scenarios: {
    claims: {
      executor: 'constant-arrival-rate',
      rate: Number(rateN),
      timeUnit,
      duration: `${Math.max(1, Math.floor(durationSec))}s`,
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<=100'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const cookie = subjects[exec.scenario.iterationInTest % subjects.length];
  const headers = { 'content-type': 'application/json', origin, cookie, ...(hostHeader ? { Host: hostHeader } : {}) };
  const res = http.post(`${apiUrl}/api/me/stamps`, JSON.stringify({ eventId, source: 'tv', at }), { headers, tags: { name: 'claim' } });
  let got = '';
  try {
    got = res.json('value.eventId') || '';
  } catch {
    got = '';
  }
  if (res.status === 0) transportErrors.add(1);
  check(res, {
    'status 200': (r) => r.status === 200,
    'stamp of the event': () => got === eventId,
  });
}

export function handleSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const line = `PRESENCE-K6 claims rate=${__ENV.RATE || '100/s'} duration=${Math.floor(durationSec)}s requests=${data.metrics.http_reqs.values.count} p95=${d['p(95)'].toFixed(1)}ms max=${d.max.toFixed(1)}ms failed=${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}% noAnswer=${data.metrics.presence_transport_errors ? data.metrics.presence_transport_errors.values.count : 0}`;
  return { stdout: `${line}\n` };
}
