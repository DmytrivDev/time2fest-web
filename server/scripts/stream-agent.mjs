// @ts-check
/**
 * Client of the stream-search agent (SPEC-21a AC-34, NFR-5). Plain Node, no dependencies, same command on Windows and Linux:
 *   node server/scripts/stream-agent.mjs <channels | candidates [--state s] [--event e] [--cursor c]
 *                                        | propose (--video id | --channel id) [--event e] [--evidence url] [--note text]
 *                                        | run>
 * Reads ONLY T2F_STREAM_AGENT_BASE_URL, T2F_STREAM_AGENT_KEY, T2F_STREAM_AGENT_ACCESS_CLIENT_ID and
 * T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET from the environment. The values are never printed: a failure names the
 * variable, or the server's error code (and retryAfterMs), nothing else. Prints the JSON `value` of a good answer.
 * Exit codes: 0 ok, 1 refused or unreachable, 2 usage error or a missing variable.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ENV_NAMES = /** @type {const} */ ([
  'T2F_STREAM_AGENT_BASE_URL',
  'T2F_STREAM_AGENT_KEY',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_ID',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET',
]);

/** Relative to the web root, where `run` is launched from. */
export const PROMPT_FILE = 'agents/stream-search/prompt.md';
export const RUN_LIMIT_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const SELF = 'node server/scripts/stream-agent.mjs';

/** The only tools the launched session may use: this client's three commands, open web pages, the prompt file. */
export const ALLOWED_TOOLS = [
  `Bash(${SELF} channels)`,
  `Bash(${SELF} candidates *)`,
  `Bash(${SELF} propose *)`,
  'WebFetch',
  `Read(${PROMPT_FILE})`,
];

/**
 * Pure: the argv of the `claude` process for `run`.
 * @returns {string[]}
 */
export function buildRunArgv() {
  return [
    '-p',
    `Follow the instructions in ${PROMPT_FILE} exactly.`,
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
    '--permission-mode',
    'dontAsk',
  ];
}

/**
 * @param {string[]} argv
 * @param {string[]} flags allowed `--name value` flags
 * @returns {{ f: Record<string, string>, error?: string }}
 */
function parseFlags(argv, flags) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--') || !flags.includes(a.slice(2))) return { f: out, error: `unknown argument ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { f: out, error: `${a} needs a value` };
    out[a.slice(2)] = v;
    i += 1;
  }
  return { f: out };
}

/**
 * @param {string[]} argv
 * @returns {{ method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: Record<string, string> } | { error: string }}
 */
export function buildRequest(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'channels') {
    return rest.length ? { error: 'channels takes no arguments' } : { method: 'GET', path: '/cms-api/stream-agent/channels' };
  }
  if (cmd === 'candidates') {
    const { f, error } = parseFlags(rest, ['state', 'event', 'cursor']);
    if (error) return { error };
    /** @type {Record<string, string>} */
    const query = {};
    if (f.state) query.state = f.state;
    if (f.event) query.eventId = f.event;
    if (f.cursor) query.cursor = f.cursor;
    return { method: 'GET', path: '/cms-api/stream-agent/candidates', query };
  }
  if (cmd === 'propose') {
    const { f, error } = parseFlags(rest, ['video', 'channel', 'event', 'evidence', 'note']);
    if (error) return { error };
    if (Boolean(f.video) === Boolean(f.channel)) return { error: 'propose needs exactly one of --video, --channel' };
    /** @type {Record<string, string>} */
    const body = f.video ? { videoId: f.video } : { channelId: f.channel ?? '' };
    if (f.event) body.eventId = f.event;
    if (f.evidence) body.evidenceUrl = f.evidence;
    if (f.note) body.note = f.note;
    return { method: 'POST', path: '/cms-api/stream-agent/candidates', body };
  }
  return { error: 'usage: channels | candidates | propose | run' };
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {(argv: string[]) => { on: Function, kill?: Function }} [spawnImpl]
 * @returns {Promise<number>}
 */
function runClaude(env, spawnImpl) {
  const argv = buildRunArgv();
  return new Promise((resolve) => {
    const child = /** @type {any} */ (
      spawnImpl
        ? spawnImpl(argv)
        : spawn('claude', argv, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })
    );
    const timer = setTimeout(() => child.kill?.(), RUN_LIMIT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(1);
    });
    child.on('close', (/** @type {number | null} */ code) => {
      clearTimeout(timer);
      resolve(code === 0 ? 0 : 1);
    });
  });
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl
 * @param {{ out: (s: string) => void, err: (s: string) => void, spawnImpl?: (argv: string[]) => { on: Function, kill?: Function } }} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, env, fetchImpl, io) {
  const { out, err } = io;
  const usage = (/** @type {string} */ message) => {
    err(`${message}\n`);
    return 2;
  };
  const missing = ENV_NAMES.filter((n) => !env[n]);
  if (missing.length) return usage(`missing environment: ${missing.join(', ')}`);
  if (argv[0] === 'run') return runClaude(env, io.spawnImpl);
  const req = buildRequest(argv);
  if ('error' in req) return usage(req.error);

  let url;
  try {
    url = new URL(req.path, /** @type {string} */ (env.T2F_STREAM_AGENT_BASE_URL));
  } catch {
    return usage('T2F_STREAM_AGENT_BASE_URL is not a valid URL');
  }
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `admins API-Key ${env.T2F_STREAM_AGENT_KEY}`,
    'CF-Access-Client-Id': /** @type {string} */ (env.T2F_STREAM_AGENT_ACCESS_CLIENT_ID),
    'CF-Access-Client-Secret': /** @type {string} */ (env.T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET),
    Accept: 'application/json',
  };
  if (req.body) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetchImpl(url, {
      method: req.method,
      headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    /** @type {any} */
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok && json && json.ok === true) {
      out(`${JSON.stringify(json.value)}\n`);
      return 0;
    }
    // Only the code (and retryAfterMs): never the body, which a proxy could fill with anything.
    const e = json && typeof json === 'object' && json.error && typeof json.error === 'object' ? json.error : {};
    const code = typeof e.code === 'string' && /^[a-z-]{1,40}$/.test(e.code) ? e.code : `http-${res.status}`;
    const retry = typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined;
    err(`${JSON.stringify(retry === undefined ? { code } : { code, retryAfterMs: retry })}\n`);
    return 1;
  } catch {
    err(`${JSON.stringify({ code: 'unreachable' })}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2), process.env, fetch, {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
