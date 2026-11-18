/* global __VU */
// Steady connections with subscriptions (AC-63). Parameters: see README.md.
import { cfg, loadTokens, tokenFor, session, pauseUntil, sinceStart, failedChecks } from './lib/centrifugo.js';

const tokens = loadTokens();
const total = cfg.rampSec + cfg.durationSec;

export const options = {
  scenarios: {
    subscribers: { executor: 'per-vu-iterations', vus: cfg.vus, iterations: 1, maxDuration: `${Math.ceil(total + 60)}s` },
  },
  thresholds: { rt_failed_checks: ['count==0'], rt_connect_ok: ['rate==1'], rt_unexpected_disconnects: ['count==0'] },
};

export default function () {
  const delay = cfg.vus > 1 ? ((__VU - 1) / cfg.vus) * cfg.rampSec : 0;
  pauseUntil(delay, () => {
    const s = session({ token: tokenFor(tokens), state: { epochs: {} }, holdUntil: total, label: 'connect' }, (ok) => {
      if (!ok && sinceStart() < total) failedChecks.add(1);
    });
    pauseUntil(total - sinceStart(), () => s.close());
  });
}
