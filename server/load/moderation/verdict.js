/* global __ENV, __ITER, __VU */
// SPEC-09 NFR-1: verdicts at a constant arrival rate through the test door POST /api/_test/moderation
// ({op:'verdict'}), with the fake AI answering in 200 ms. Pass: p95 < 700 ms, no failed request, no
// `fallback` verdict. The door answers a loopback Host only: HOST_HEADER carries it (the runner sets it).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const seconds = (text, dflt) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text || '');
  if (!m) return dflt;
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2] || 's'];
};
const apiUrl = (__ENV.API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const hostHeader = __ENV.HOST_HEADER || '';
const durationSec = seconds(__ENV.DURATION, 300);
const [rateN, rateUnit] = (__ENV.RATE || '3000/min').split('/');
const timeUnit = { s: '1s', sec: '1s', min: '1m', m: '1m', h: '1h' }[rateUnit || 'min'] || '1m';

export const fallbackVerdicts = new Counter('mod_fallback_verdicts');

export const options = {
  scenarios: {
    verdicts: {
      executor: 'constant-arrival-rate',
      rate: Number(rateN),
      timeUnit,
      duration: `${Math.max(1, Math.floor(durationSec))}s`,
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<700'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    mod_fallback_verdicts: ['count==0'],
  },
};

const headers = { 'content-type': 'application/json', ...(hostHeader ? { Host: hostHeader } : {}) };

export default function () {
  // A clean chat line, different per request (no rule issue: every verdict reaches the providers).
  const body = JSON.stringify({ op: 'verdict', kind: 'message', text: `Happy New Year from load ${__VU}-${__ITER}` });
  const res = http.post(`${apiUrl}/api/_test/moderation`, body, { headers });
  let source = '';
  try {
    source = res.json('value.source') || '';
  } catch {
    source = '';
  }
  if (source === 'fallback') fallbackVerdicts.add(1);
  check(res, {
    'status 200': (r) => r.status === 200,
    'verdict not from the fallback filter': () => source !== '' && source !== 'fallback',
  });
}
