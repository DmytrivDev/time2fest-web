#!/usr/bin/env node
// @ts-check
/**
 * k6 runner for the realtime load scripts (SPEC-06 W42, AC-63 ... AC-65) and the moderation verdict
 * load (SPEC-09 NFR-1).
 *
 *   node scripts/k6.mjs --scenario moderation [--rate 3000/min] [--duration 5m] [--api-url URL]
 *   node scripts/k6.mjs --scenario presence [--part beats|claims|both] [--rate 200/s] [--claim-rate 100/s]
 *        [--duration 60s] [--subjects 1200] [--event evt_london_2027] [--api-url URL]   (SPEC-14 NFR-1, NFR-2;
 *        needs this worktree's served test-class server, e.g. `node scripts/stack.mjs serve`)
 *   node scripts/k6.mjs --scenario steady|publish|storm --vus N [--ramp 30s] [--duration 90s]
 *        [--token anon|door:0.1] [--channels site:state,rttest:batch] [--rate 1000/min] [--origin URL]
 *        [--ws-url URL] [--api-url URL] [--network NAME] [--prefix TEXT] [--storm-at 40s] [--storm-window 5s]
 *
 * Local default: the k6 container joins the compose network and talks to `centrifugo:8000`.
 * Channel names get this worktree's prefix (AC-10 rule, test class). For a remote Centrifugo pass
 * `--ws-url`, `--api-url`, `--prefix ''` and `--network ''`; the API key then comes from
 * `T2F_CENTRIFUGO_API_KEY`. The key goes to a temp env file (never argv) that is deleted afterwards.
 *
 * `moderation` posts `{op:'verdict'}` to the test door `/api/_test/moderation` of this worktree's
 * server (test class, doors on, AI URLs pointing at the fake with a 200 ms delay). The k6 container
 * reaches the host through `host.docker.internal`; the door answers a loopback `Host` only, so the
 * script sends `Host: 127.0.0.1:<port>`. No secret is involved.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realtimeSecretsFile, ensureRealtimeSecrets } from './lib/realtimeSecrets.mjs';
import { resolveWorktree } from './lib/worktree.mjs';

export const K6_IMAGE = 'grafana/k6:2.4.0';
export const SCENARIOS = ['steady', 'publish', 'storm', 'moderation', 'presence'];
/** Scenarios that talk to the server (its test doors or routes), not to Centrifugo. */
export const SERVER_SCENARIOS = ['moderation', 'presence'];
/** The parts of the `presence` scenario (SPEC-14 NFR-1 beats, NFR-2 claims). */
export const PRESENCE_PARTS = ['beats', 'claims'];
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} scenario */
export const loadDirFor = (scenario) =>
  path.join(serverDir, 'load', scenario === 'presence' ? 'presence' : SERVER_SCENARIOS.includes(scenario) ? 'moderation' : 'realtime');
/** The script file of a scenario inside its load directory (`presence` runs `beats`, then `claims`). @param {string} scenario */
export const scriptFor = (scenario) => (scenario === 'moderation' ? 'verdict' : scenario === 'presence' ? 'beats' : scenario);

/** @typedef {{ scenario: string, vus: number, ramp: string, duration: string, token: string, channels: string[], rate: string, origin: string, wsUrl: string | undefined, apiUrl: string | undefined, network: string | undefined, prefix: string | undefined, stormAt: string | undefined, stormWindow: string | undefined, claimRate: string, event: string, subjects: number, parts: string[] }} Args */

/**
 * @param {string[]} argv
 * @returns {Args}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const raw = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1];
    if (!flag.startsWith('--') || value === undefined) throw new Error(`bad argument near "${flag}"`);
    raw[flag.slice(2)] = value;
  }
  const scenario = raw.scenario ?? '';
  if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of ${SCENARIOS.join('|')}`);
  const vus = Number(raw.vus ?? '10');
  if (!Number.isInteger(vus) || vus < 1) throw new Error('--vus must be a positive integer');
  const token = raw.token ?? 'anon';
  if (token !== 'anon' && !/^door:(0(\.\d+)?|1(\.0+)?)$/.test(token)) throw new Error('--token must be anon or door:<share 0-1>');
  const server = SERVER_SCENARIOS.includes(scenario);
  const channels = (raw.channels ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!server && channels.length === 0) throw new Error('--channels needs at least one channel');
  const presence = scenario === 'presence';
  const rate = raw.rate ?? (presence ? '200/s' : server ? '3000/min' : '60/min');
  if (!/^\d+\/(s|sec|min|m|h)$/.test(rate)) throw new Error('--rate must be N/s, N/min or N/h');
  const claimRate = raw['claim-rate'] ?? '100/s';
  if (!/^\d+\/(s|sec|min|m|h)$/.test(claimRate)) throw new Error('--claim-rate must be N/s, N/min or N/h');
  const event = raw.event ?? 'evt_london_2027';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(event)) throw new Error('--event must be an event id');
  const subjects = Number(raw.subjects ?? '1200');
  if (!Number.isInteger(subjects) || subjects < 1 || subjects > 5000) throw new Error('--subjects must be 1..5000');
  const parts = (raw.part ?? 'both') === 'both' ? PRESENCE_PARTS : [raw.part ?? ''];
  if (!parts.every((p) => PRESENCE_PARTS.includes(p))) throw new Error('--part must be beats|claims|both');
  if (raw['api-url'] !== undefined && !/^https?:\/\/[^/\s]+\/?$/.test(raw['api-url'])) throw new Error('--api-url must be an http(s) origin');
  return {
    scenario,
    vus,
    ramp: raw.ramp ?? '0s',
    duration: raw.duration ?? (server && !presence ? '5m' : '60s'),
    token,
    channels,
    rate,
    origin: raw.origin ?? '',
    wsUrl: raw['ws-url'],
    apiUrl: raw['api-url'],
    network: raw.network,
    prefix: raw.prefix,
    stormAt: raw['storm-at'],
    stormWindow: raw['storm-window'],
    claimRate,
    event,
    subjects,
    parts,
  };
}

/**
 * AC-10 (test class): `<namespace>:<prefix><rest>`, or `<prefix><name>` without a namespace.
 * @param {string} name
 * @param {string} prefix
 */
export function prefixChannel(name, prefix) {
  const i = name.indexOf(':');
  return i === -1 ? `${prefix}${name}` : `${name.slice(0, i + 1)}${prefix}${name.slice(i + 1)}`;
}

/** @param {string} text @returns {number} seconds */
export function toSeconds(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text);
  if (!m) throw new Error(`bad duration "${text}"`);
  const n = Number(m[1]);
  /** @type {Record<string, number>} */
  const k = { ms: 0.001, s: 1, m: 60, h: 3600 };
  return n * (k[m[2] ?? 's'] ?? 1);
}

/**
 * The environment passed into the container (everything except the API key goes here too, but
 * the key is the only secret; it is written to the env file only).
 * @param {Args} a @param {string} prefix @param {{ network: string | undefined, wsUrl: string, apiUrl: string, tokensFile: string }} t
 * @returns {Record<string, string>}
 */
export function k6Env(a, prefix, t) {
  /** @type {Record<string, string>} */
  const env = {
    WS_URL: t.wsUrl,
    API_URL: t.apiUrl,
    VUS: String(a.vus),
    RAMP: a.ramp,
    DURATION: a.duration,
    TOKEN_SOURCE: a.token,
    CHANNELS: a.channels.map((c) => prefixChannel(c, prefix)).join(','),
    PUBLISH_RATE: a.rate,
  };
  if (t.tokensFile !== '') env.TOKENS_FILE = t.tokensFile;
  if (a.origin !== '') env.ORIGIN = a.origin;
  if (a.stormAt !== undefined) env.STORM_AT = a.stormAt;
  if (a.stormWindow !== undefined) env.STORM_WINDOW = a.stormWindow;
  return env;
}

/**
 * The environment of the `moderation` scenario: the server origin as the container sees it and the
 * loopback `Host` the door requires (the server's port on the host).
 * @param {Args} a @param {number} serverPort
 * @returns {Record<string, string>}
 */
export function moderationEnv(a, serverPort) {
  const apiUrl = (a.apiUrl ?? `http://host.docker.internal:${serverPort}`).replace(/\/+$/, '');
  const port = new URL(apiUrl).port || String(serverPort);
  return { API_URL: apiUrl, HOST_HEADER: `127.0.0.1:${port}`, RATE: a.rate, DURATION: a.duration };
}

/**
 * The `docker` argv. The key is in neither argv nor the env map: only the env file path is.
 * @param {{ scenario: string, loadDir: string, dataDir: string | undefined, envFile: string, network: string | undefined, image?: string, hostGateway?: boolean, script?: string }} o
 * @returns {string[]}
 */
export function buildDockerArgs(o) {
  return [
    'run',
    '--rm',
    ...(o.network ? ['--network', o.network] : []),
    ...(o.hostGateway ? ['--add-host', 'host.docker.internal:host-gateway'] : []),
    '-v',
    `${o.loadDir}:/scripts:ro`,
    ...(o.dataDir ? ['-v', `${o.dataDir}:/data:ro`] : []),
    '--env-file',
    o.envFile,
    o.image ?? K6_IMAGE,
    'run',
    '--quiet',
    `/scripts/${o.script ?? scriptFor(o.scenario)}.js`,
  ];
}


const envFileText = (/** @type {Record<string, string>} */ env) =>
  Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

/**
 * Pre-fetches door tokens on the host (the door answers loopback `Host` only).
 * @param {number} port @param {number} count @param {number} ttl
 * @returns {Promise<string[]>}
 */
async function fetchDoorTokens(port, count, ttl) {
  /** @type {string[]} */
  const tokens = [];
  for (let i = 0; i < count; i += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, count - i) }, async (_, j) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/_test/realtime-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subject: { kind: 'guest', id: `k6-${i + j}` }, ttlSeconds: ttl }),
        });
        const body = /** @type {{ ok?: boolean, value?: { token?: string } }} */ (await res.json());
        if (!res.ok || !body.value?.token) throw new Error(`token door answered ${res.status}`);
        return body.value.token;
      }),
    );
    tokens.push(...batch);
  }
  return tokens;
}

/**
 * The `moderation` run: no secret, no data mount, no compose network; the host through the gateway.
 * @param {Args} a @param {number} serverPort
 */
function runModeration(a, serverPort) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `t2f-k6-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    const env = moderationEnv(a, serverPort);
    const envFile = path.join(tmp, 'k6.env');
    fs.writeFileSync(envFile, envFileText(env), { mode: 0o600 });
    const args = buildDockerArgs({ scenario: a.scenario, loadDir: loadDirFor(a.scenario), dataDir: undefined, envFile, network: undefined, hostGateway: a.apiUrl === undefined });
    console.log(`k6 moderation: ${a.rate} verdicts for ${a.duration} against ${env.API_URL} (Host ${env.HOST_HEADER})`);
    const r = spawnSync('docker', args, { stdio: 'inherit', shell: false });
    process.exitCode = r.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const PRESENCE_ORIGIN = 'http://localhost:3000';

/**
 * The environment of one `presence` part: the server origin as the container sees it, the loopback `Host`, the
 * event, the claim `at`, the rate and the duration. The subjects' cookies are a mounted file, never env.
 * @param {Args} a @param {number} serverPort @param {'beats' | 'claims'} part @param {number} moment
 * @returns {Record<string, string>}
 */
export function presenceEnv(a, serverPort, part, moment) {
  const apiUrl = (a.apiUrl ?? `http://host.docker.internal:${serverPort}`).replace(/\/+$/, '');
  const port = new URL(apiUrl).port || String(serverPort);
  return {
    API_URL: apiUrl,
    HOST_HEADER: `127.0.0.1:${port}`,
    ORIGIN: PRESENCE_ORIGIN,
    EVENT_ID: a.event,
    CLAIM_AT: String(moment),
    RATE: part === 'beats' ? a.rate : a.claimRate,
    DURATION: a.duration,
    SUBJECTS_FILE: '/data/subjects.json',
  };
}

/**
 * A loopback call of this worktree's server (doors answer a loopback `Host` only).
 * @param {number} port @param {string} p @param {unknown} body @param {string} [cookie]
 */
async function presencePost(port, p, body, cookie) {
  /** @type {Response | undefined} */
  let res;
  // A connection dropped while the server drains a load backlog is retried (the calls are idempotent).
  for (let attempt = 1; !res; attempt += 1) {
    try {
      res = await fetch(`http://127.0.0.1:${port}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PRESENCE_ORIGIN, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  const json = /** @type {{ ok?: boolean, value?: any, error?: { code?: string } }} */ (await res.json().catch(() => ({})));
  return { status: res.status, json, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

/**
 * Guests are created on a first write and limited to 60 per 10 min per client; a served test-class server has no
 * edge secret, so every local request is one client. Between batches the runner drops the guest-creation counters of
 * this worktree's Redis database (local stack only, test class).
 * @param {{ redisDb: number }} wt
 */
function clearGuestLimits(wt) {
  const id = spawnSync('docker', ['ps', '-q', '--filter', 'label=com.docker.compose.project=t2f', '--filter', 'label=com.docker.compose.service=redis'], {
    encoding: 'utf8',
  }).stdout.trim();
  if (!id) throw new Error('shared Redis container not found');
  const keys = spawnSync('docker', ['exec', id, 'redis-cli', '-n', String(wt.redisDb), '--scan', '--pattern', '*rl:auth-guest-create*'], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length > 0) spawnSync('docker', ['exec', id, 'redis-cli', '-n', String(wt.redisDb), 'DEL', ...keys], { encoding: 'utf8' });
}

/**
 * The `presence` run (SPEC-14 NFR-1, NFR-2) against this worktree's served test-class server: the event's moment from
 * the health door; guests through the write probe; the clock frozen at m − 10 s for the beats (inside the window)
 * and at m + 20 s for the claims (after the stamp moment; every subject beat first, so a claim is a grant or the
 * existing stamp). The clock goes back to real time afterwards.
 * @param {Args} a @param {{ ports: { server: number }, redisDb: number }} wt
 */
async function runPresence(a, wt) {
  const port = wt.ports.server;
  const health = await presencePost(port, '/api/_test/presence/health', { eventId: a.event });
  /** @type {number[]} */
  const moments = health.json.value?.moments ?? [];
  const moment = moments[moments.length - 1];
  if (health.status !== 200 || moment === undefined) throw new Error(`presence-health door answered ${health.status} for ${a.event}`);
  const clockTo = async (/** @type {number} */ at) => {
    const r = await presencePost(port, '/api/_test/clock', { at, frozen: true });
    if (r.status !== 200) throw new Error(`clock door answered ${r.status}`);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `t2f-k6-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    await clockTo(moment - 10_000);
    /** @type {string[]} */
    const subjects = [];
    for (let i = 0; i < a.subjects; i += 50) {
      clearGuestLimits(wt);
      const batch = await Promise.all(
        Array.from({ length: Math.min(50, a.subjects - i) }, async () => {
          const r = await presencePost(port, '/api/_test/auth/write-probe', {});
          if (r.status !== 200 || r.cookie === '') throw new Error(`write-probe door answered ${r.status}`);
          // One untimed beat each, so a claims-only run has proofs too.
          const b = await presencePost(port, '/api/presence', { eventIds: [a.event], source: 'tv' }, r.cookie);
          if (b.status !== 200) throw new Error(`first beat answered ${b.status} ${b.json.error?.code ?? ''}`);
          return r.cookie;
        }),
      );
      subjects.push(...batch);
    }
    clearGuestLimits(wt);
    fs.writeFileSync(path.join(tmp, 'subjects.json'), JSON.stringify(subjects), { mode: 0o600 });
    let failed = 0;
    for (const part of a.parts) {
      if (part === 'claims') await clockTo(moment + 20_000);
      const env = presenceEnv(a, port, /** @type {'beats' | 'claims'} */ (part), moment);
      const envFile = path.join(tmp, `${part}.env`);
      fs.writeFileSync(envFile, envFileText(env), { mode: 0o600 });
      const args = buildDockerArgs({ scenario: a.scenario, script: part, loadDir: loadDirFor(a.scenario), dataDir: tmp, envFile, network: undefined, hostGateway: a.apiUrl === undefined });
      console.log(`k6 presence ${part}: ${env.RATE} for ${a.duration}, ${subjects.length} subjects, event ${a.event} (m=${new Date(moment).toISOString()}) against ${env.API_URL}`);
      const r = spawnSync('docker', args, { stdio: 'inherit', shell: false });
      if (r.status !== 0) failed = r.status ?? 1;
      console.log(`k6 presence ${part}: ${r.status === 0 ? 'thresholds passed' : `FAILED (exit ${r.status})`}`);
    }
    process.exitCode = failed;
  } finally {
    await presencePost(port, '/api/_test/clock', { at: Date.now(), speed: 1, frozen: false }).catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const wt = resolveWorktree(serverDir, process.env);
  if (a.scenario === 'presence') return runPresence(a, wt);
  if (SERVER_SCENARIOS.includes(a.scenario)) return runModeration(a, wt.ports.server);
  const local = a.wsUrl === undefined;
  const prefix = a.prefix ?? (local ? wt.channelPrefix : '');
  const network = a.network ?? (local ? 't2f_default' : undefined);
  const apiKey =
    process.env.T2F_CENTRIFUGO_API_KEY ||
    ensureRealtimeSecrets(realtimeSecretsFile(serverDir, process.env)).T2F_CENTRIFUGO_API_KEY;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `t2f-k6-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    /** @type {string | undefined} */
    let dataDir;
    let tokensFile = '';
    if (a.token !== 'anon') {
      const share = Number(a.token.slice('door:'.length));
      const count = Math.ceil(share * a.vus);
      const ttl = Math.min(4500, Math.ceil(toSeconds(a.ramp) + toSeconds(a.duration)) + 300);
      const tokens = count > 0 ? await fetchDoorTokens(wt.ports.server, count, ttl) : [];
      dataDir = tmp;
      fs.writeFileSync(path.join(tmp, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });
      tokensFile = '/data/tokens.json';
    }
    const env = k6Env(a, prefix, {
      network,
      wsUrl: a.wsUrl ?? 'ws://centrifugo:8000/connection/websocket',
      apiUrl: a.apiUrl ?? 'http://centrifugo:8000',
      tokensFile,
    });
    const envFile = path.join(tmp, 'k6.env');
    fs.writeFileSync(envFile, envFileText({ ...env, API_KEY: apiKey }), { mode: 0o600 });
    const args = buildDockerArgs({ scenario: a.scenario, loadDir: loadDirFor(a.scenario), dataDir, envFile, network });
    console.log(`k6 ${a.scenario}: ${a.vus} connections, ramp ${a.ramp}, duration ${a.duration}, channels ${env.CHANNELS}`);
    const r = spawnSync('docker', args, { stdio: 'inherit', shell: false });
    process.exitCode = r.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
