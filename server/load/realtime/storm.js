/* global __VU */
// Reconnect storm (AC-64): every socket is closed at a random moment in [STORM_AT, STORM_AT + STORM_WINDOW]
// (seconds since the start), then reconnects at once asking to recover each subscription.
// Reports the reconnect success share, the recovered subscription share and token requests.
import { cfg, loadTokens, tokenFor, session, pauseUntil, sinceStart } from './lib/centrifugo.js';

const tokens = loadTokens();
const stormAt = cfg.stormAtSec !== undefined ? cfg.stormAtSec : cfg.rampSec + 5;
const total = Math.max(cfg.rampSec + cfg.durationSec, stormAt + cfg.stormWindowSec + 20);

export const options = {
  scenarios: {
    sockets: { executor: 'per-vu-iterations', vus: cfg.vus, iterations: 1, maxDuration: `${Math.ceil(total + 60)}s` },
  },
  thresholds: { rt_connect_ok: ['rate==1'], rt_reconnect_ok: ['rate==1'] },
};

export default function () {
  const token = tokenFor(tokens);
  const state = { epochs: {} };
  const delay = cfg.vus > 1 ? ((__VU - 1) / cfg.vus) * cfg.rampSec : 0;
  pauseUntil(delay, () => {
    const open = (label) => session({ token, state, holdUntil: total, label }, () => {});
    const first = open('connect');
    pauseUntil(stormAt + Math.random() * cfg.stormWindowSec - sinceStart(), () => {
      first.close();
      const again = open('reconnect');
      pauseUntil(total - sinceStart(), () => again.close());
    });
  });
}
