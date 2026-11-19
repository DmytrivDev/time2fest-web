#!/usr/bin/env node
// @ts-check
/**
 * k6 runner for the realtime load scripts (SPEC-06 W42, AC-63 ... AC-65) and the moderation verdict
 * load (SPEC-09 NFR-1).
 *
 *   node scripts/k6.mjs --scenario moderation [--rate 3000/min] [--duration 5m] [--api-url URL]
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
export const SCENARIOS = ['steady', 'publish', 'storm', 'moderation'];
/** Scenarios that talk to the server's test door, not to Centrifugo. */
export const SERVER_SCENARIOS = ['moderation'];
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} scenario */
export const loadDirFor = (scenario) => path.join(serverDir, 'load', SERVER_SCENARIOS.includes(scenario) ? 'moderation' : 'realtime');
/** The script file of a scenario inside its load directory. @param {string} scenario */
export const scriptFor = (scenario) => (scenario === 'moderation' ? 'verdict' : scenario);

/** @typedef {{ scenario: string, vus: number, ramp: string, duration: string, token: string, channels: string[], rate: string, origin: string, wsUrl: string | undefined, apiUrl: string | undefined, network: string | undefined, prefix: string | undefined, stormAt: string | undefined, stormWindow: string | undefined }} Args */

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
  const rate = raw.rate ?? (server ? '3000/min' : '60/min');
  if (!/^\d+\/(s|sec|min|m|h)$/.test(rate)) throw new Error('--rate must be N/s, N/min or N/h');
  if (raw['api-url'] !== undefined && !/^https?:\/\/[^/\s]+\/?$/.test(raw['api-url'])) throw new Error('--api-url must be an http(s) origin');
  return {
    scenario,
    vus,
    ramp: raw.ramp ?? '0s',
    duration: raw.duration ?? (server ? '5m' : '60s'),
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
 * @param {{ scenario: string, loadDir: string, dataDir: string | undefined, envFile: string, network: string | undefined, image?: string, hostGateway?: boolean }} o
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
    `/scripts/${scriptFor(o.scenario)}.js`,
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

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const wt = resolveWorktree(serverDir, process.env);
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
