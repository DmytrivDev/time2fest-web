/* global __ENV, __VU, open */
// k6 helpers for the Centrifugo v6 JSON protocol (SPEC-06 AC-63 ... AC-65).
// Parameters come from environment variables only; no secret is ever hard-coded or logged.
import { WebSocket } from 'k6/websockets';
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

export const failedChecks = new Counter('rt_failed_checks');
export const connectOk = new Rate('rt_connect_ok');
export const reconnectOk = new Rate('rt_reconnect_ok');
export const recoveredSubs = new Rate('rt_recovered_subscriptions');
export const tokenRequests = new Counter('rt_token_requests');
export const noPong = new Counter('rt_disconnect_3012_no_pong');
export const unexpectedCloses = new Counter('rt_unexpected_disconnects');
export const delivery = new Trend('rt_delivery_latency_ms', true);
export const received = new Counter('rt_messages_received');
export const published = new Counter('rt_messages_published');

const num = (name, dflt) => (__ENV[name] !== undefined && __ENV[name] !== '' ? Number(__ENV[name]) : dflt);

/** Parses `30s`, `2m`, `1h` or a bare number of seconds into seconds. */
export function seconds(text, dflt) {
  if (text === undefined || text === '') return dflt;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text));
  if (!m) throw new Error(`bad duration "${text}"`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 's'];
}

export const cfg = {
  wsUrl: __ENV.WS_URL || 'ws://127.0.0.1:8000/connection/websocket',
  apiUrl: __ENV.API_URL || 'http://127.0.0.1:8000',
  vus: num('VUS', 10),
  rampSec: seconds(__ENV.RAMP, 0),
  durationSec: seconds(__ENV.DURATION, 60),
  tokenSource: __ENV.TOKEN_SOURCE || 'anon',
  tokensFile: __ENV.TOKENS_FILE || '',
  channels: (__ENV.CHANNELS || '').split(',').map((c) => c.trim()).filter(Boolean),
  publishRate: __ENV.PUBLISH_RATE || '60/min',
  origin: __ENV.ORIGIN || '',
  stormAtSec: seconds(__ENV.STORM_AT, undefined),
  stormWindowSec: seconds(__ENV.STORM_WINDOW, 5),
};

/** Tokens file (JSON array of strings), opened in the init context only. */
export function loadTokens() {
  if (cfg.tokenSource === 'anon' || cfg.tokensFile === '') return [];
  return JSON.parse(open(cfg.tokensFile));
}

/** The token of the current VU: the first VUs get door tokens, the others connect anonymously. */
export function tokenFor(tokens) {
  const i = __VU - 1;
  return i < tokens.length ? tokens[i] : '';
}

/** Splits a frame into protocol messages (newline-delimited JSON). */
function messages(data) {
  return String(data)
    .split('\n')
    .filter((s) => s !== '')
    .map((s) => JSON.parse(s));
}

/** Seconds elapsed since the scenario started. */
export const sinceStart = () => (Date.now() - exec.scenario.startTime) / 1000;

/**
 * Opens one connection, subscribes to every channel and runs until `holdUntil` (seconds since the
 * scenario start) or the optional `closeAt` callback result. Calls back with the outcome.
 *
 * state: { epochs: {channel: {epoch, offset}} } is kept between reconnects to ask for recovery.
 * options: { token, state, holdUntil, label ('connect' | 'reconnect'), onOpen(ws) }
 */
export function session(options, done) {
  const { token, state, holdUntil, label } = options;
  const ws = new WebSocket(cfg.wsUrl, null, cfg.origin ? { headers: { Origin: cfg.origin } } : undefined);
  const rate = label === 'reconnect' ? reconnectOk : connectOk;
  let connected = false;
  let pendingSubs = 0;
  let nextId = 1;
  const subIds = {};
  let closedByUs = false;

  // Zero-valued counters still appear in the summary.
  tokenRequests.add(0);
  noPong.add(0);
  const send = (obj) => ws.send(JSON.stringify(obj));

  ws.onopen = () => {
    const connect = { name: 'k6' };
    if (token) connect.token = token;
    send({ id: nextId++, connect });
  };

  ws.onmessage = (event) => {
    let list;
    try {
      list = messages(event.data);
    } catch {
      failedChecks.add(1);
      return;
    }
    for (const msg of list) {
      if (Object.keys(msg).length === 0) {
        ws.send('{}'); // server ping -> pong (AC-65)
      } else if (msg.connect !== undefined && !connected) {
        if (msg.error || msg.connect.error) {
          rate.add(false);
          failedChecks.add(1);
          if (msg.error && msg.error.code === 109) tokenRequests.add(1); // token expired: a refresh would be needed
          closedByUs = true;
          ws.close();
          return;
        }
        connected = true;
        rate.add(true);
        pendingSubs = cfg.channels.length;
        for (const channel of cfg.channels) {
          const id = nextId++;
          subIds[id] = channel;
          const sub = { channel };
          const prev = state.epochs[channel];
          if (label === 'reconnect' && prev) {
            sub.recover = true;
            sub.epoch = prev.epoch;
            sub.offset = prev.offset;
          }
          send({ id, subscribe: sub });
        }
        if (options.onOpen) options.onOpen(ws);
      } else if (msg.id !== undefined && subIds[msg.id] !== undefined) {
        const channel = subIds[msg.id];
        if (msg.error) {
          failedChecks.add(1);
        } else {
          const r = msg.subscribe || {};
          if (r.recoverable) {
            state.epochs[channel] = { epoch: r.epoch, offset: r.offset || 0 };
            if (label === 'reconnect') recoveredSubs.add(r.recovered === true);
          }
          pendingSubs -= 1;
        }
      } else if (msg.push !== undefined) {
        const pub = msg.push.pub;
        if (pub) {
          received.add(1);
          const st = state.epochs[msg.push.channel];
          if (st && pub.offset !== undefined) st.offset = pub.offset;
          const t = pub.data && pub.data.t;
          if (typeof t === 'number') delivery.add(Date.now() - t);
        }
      }
    }
  };

  ws.onerror = () => {
    if (!connected) rate.add(false);
  };

  ws.onclose = (event) => {
    if (event && event.code === 3012) noPong.add(1);
    if (!closedByUs && sinceStart() < holdUntil) unexpectedCloses.add(1);
    done(connected && pendingSubs === 0);
  };

  return {
    ws,
    close() {
      closedByUs = true;
      ws.close();
    },
  };
}

/** Publishes one message `{t: now}` through the Centrifugo HTTP API (X-API-Key from the environment). */
export function publishOnce(channel) {
  const res = http.post(
    `${cfg.apiUrl}/api/publish`,
    JSON.stringify({ channel, data: { t: Date.now() } }),
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': __ENV.API_KEY || '' } },
  );
  const ok = res.status === 200 && !(res.json() || {}).error;
  if (!ok) failedChecks.add(1);
  else published.add(1);
  return ok;
}

/** Waits `seconds` (a plain sleep that keeps the event loop running for the socket callbacks). */
export function pauseUntil(seconds, fn) {
  setTimeout(fn, Math.max(0, seconds) * 1000);
}
