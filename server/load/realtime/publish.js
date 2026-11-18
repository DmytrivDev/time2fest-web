/* global __VU */
// Subscribers plus one publisher calling POST /api/publish at PUBLISH_RATE, measuring delivery latency (AC-63).
// The publisher uses API_URL and API_KEY (env). Latency is the time from the publisher's `t` to the subscriber's receipt.
import { cfg, loadTokens, tokenFor, session, pauseUntil, sinceStart, failedChecks, publishOnce } from './lib/centrifugo.js';

const tokens = loadTokens();
const total = cfg.rampSec + cfg.durationSec;
const [rateN, rateUnit] = cfg.publishRate.split('/');
const unit = { s: '1s', sec: '1s', min: '1m', m: '1m', h: '1h' }[rateUnit || 'min'] || '1m';

export const options = {
  scenarios: {
    subscribers: { executor: 'per-vu-iterations', exec: 'subscriber', vus: cfg.vus, iterations: 1, maxDuration: `${Math.ceil(total + 60)}s` },
    publisher: {
      executor: 'constant-arrival-rate',
      exec: 'publisher',
      rate: Number(rateN),
      timeUnit: unit,
      duration: `${Math.max(1, Math.floor(cfg.durationSec))}s`,
      startTime: `${Math.ceil(cfg.rampSec + 2)}s`,
      preAllocatedVUs: 2,
      maxVUs: 20,
    },
  },
  thresholds: {
    rt_failed_checks: ['count==0'],
    rt_connect_ok: ['rate==1'],
    rt_unexpected_disconnects: ['count==0'],
    rt_delivery_latency_ms: ['p(95)<1000'],
  },
};

export function subscriber() {
  const delay = cfg.vus > 1 ? ((__VU - 1) / cfg.vus) * cfg.rampSec : 0;
  pauseUntil(delay, () => {
    const s = session({ token: tokenFor(tokens), state: { epochs: {} }, holdUntil: total, label: 'connect' }, (ok) => {
      if (!ok && sinceStart() < total) failedChecks.add(1);
    });
    pauseUntil(total - sinceStart(), () => s.close());
  });
}

let n = 0;
export function publisher() {
  const channel = cfg.channels[n++ % cfg.channels.length];
  publishOnce(channel);
}
