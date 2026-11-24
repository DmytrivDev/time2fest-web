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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ENV_NAMES = /** @type {const} */ ([
  'T2F_STREAM_AGENT_BASE_URL',
  'T2F_STREAM_AGENT_KEY',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_ID',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET',
]);
/** The variables whose values must never leave the PC in a request argument (S21-02). */
export const SECRET_ENV_NAMES = /** @type {const} */ ([
  'T2F_STREAM_AGENT_KEY',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_ID',
  'T2F_STREAM_AGENT_ACCESS_CLIENT_SECRET',
]);

/** Relative to the web root; `run` reads it and passes it by stdin, the session never reads files. */
export const PROMPT_FILE = 'agents/stream-search/prompt.md';
export const RUN_LIMIT_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
/** How the prompt names this client; `run` replaces it with the absolute command. */
export const PROMPT_SELF = 'node server/scripts/stream-agent.mjs';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');

/**
 * The client as the launched session must call it: absolute path (the session runs in an empty temp cwd), forward slashes.
 * @param {string} scriptPath
 */
export function selfCommand(scriptPath) {
  return `node "${scriptPath.replace(/\\/g, '/')}"`;
}

/**
 * The only tools the launched session may use: this client's three commands and opening web pages.
 * @param {string} self
 */
export function allowedTools(self) {
  return [`Bash(${self} channels)`, `Bash(${self} candidates *)`, `Bash(${self} propose *)`, 'WebFetch'];
}

/** Denied even though WebFetch is allowed (S21-05): YouTube pages (API policy) and services on the owner's PC. */
export const DISALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebSearch',
  'Task',
  'WebFetch(domain:youtube.com)',
  'WebFetch(domain:www.youtube.com)',
  'WebFetch(domain:m.youtube.com)',
  'WebFetch(domain:music.youtube.com)',
  'WebFetch(domain:youtu.be)',
  'WebFetch(domain:localhost)',
  'WebFetch(domain:127.0.0.1)',
  'WebFetch(domain:[::1])',
  'WebFetch(domain:0.0.0.0)',
];

/**
 * Pure: the argv of the `claude` process for `run` (S21-01). The prompt goes by stdin. Only Bash and WebFetch exist
 * in the session; no MCP servers, no user/project/local settings (so no hooks, plugins, permission rules from them).
 * @param {string} [self]
 * @returns {string[]}
 */
export function buildRunArgv(self = selfCommand(SCRIPT_PATH)) {
  return [
    '-p',
    '--input-format',
    'text',
    '--tools',
    'Bash,WebFetch',
    '--allowedTools',
    allowedTools(self).join(','),
    '--disallowedTools',
    DISALLOWED_TOOLS.join(','),
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
  ];
}

/**
 * The prompt with the client named by its absolute command.
 * @param {string} text
 * @param {string} self
 */
export function promptFor(text, self) {
  return text.split(PROMPT_SELF).join(self);
}

/**
 * Resolves the claude executable without a shell (S21-04). On Windows the npm shim `claude.cmd` cannot be spawned
 * without a shell, so it finds `claude.exe` on PATH or the binary the shim points to.
 * @param {NodeJS.Platform} platform
 * @param {string | undefined} pathVar
 * @param {(p: string) => boolean} [exists]
 * @returns {string | undefined}
 */
export function resolveClaude(platform, pathVar, exists = existsSync) {
  if (platform !== 'win32') return 'claude';
  const dirs = (pathVar ?? '').split(';').filter(Boolean);
  for (const d of dirs) {
    const exe = path.win32.join(d, 'claude.exe');
    if (exists(exe)) return exe;
    if (exists(path.win32.join(d, 'claude.cmd'))) {
      const bin = path.win32.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (exists(bin)) return bin;
    }
  }
  return undefined;
}

/**
 * The value of a secret variable inside any argument (S21-02): the agent may have been steered to expand `$T2F_...`.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function holdsSecret(argv, env) {
  const values = SECRET_ENV_NAMES.map((n) => env[n]).filter((v) => typeof v === 'string' && v.length > 0);
  return argv.some((a) => values.some((v) => a.includes(/** @type {string} */ (v))));
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
 * @typedef {{ argv: string[], cwd: string, input: string }} RunSpec
 * @typedef {(spec: RunSpec) => { on: Function, kill?: Function }} SpawnImpl
 */

/**
 * @param {Record<string, string | undefined>} env
 * @param {(s: string) => void} err
 * @param {SpawnImpl} [spawnImpl]
 * @returns {Promise<number>}
 */
function runClaude(env, err, spawnImpl) {
  const self = selfCommand(SCRIPT_PATH);
  const argv = buildRunArgv(self);
  let input;
  try {
    input = promptFor(readFileSync(path.join(WEB_ROOT, PROMPT_FILE), 'utf8'), self);
  } catch {
    err(`cannot read ${PROMPT_FILE}\n`);
    return Promise.resolve(2);
  }
  // An empty directory outside the repository: nothing for the session to read, no CLAUDE.md or project settings.
  const cwd = mkdtempSync(path.join(tmpdir(), 't2f-stream-agent-'));
  const cleanup = () => {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  /** @type {any} */
  let child;
  if (spawnImpl) child = spawnImpl({ argv, cwd, input });
  else {
    const exe = resolveClaude(process.platform, process.env.PATH ?? process.env.Path);
    if (!exe) {
      cleanup();
      err('claude executable not found on PATH\n');
      return Promise.resolve(2);
    }
    child = spawn(exe, argv, { cwd, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, ...env }, shell: false });
    child.stdin?.end(input);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill?.(), RUN_LIMIT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      cleanup();
      resolve(1);
    });
    child.on('close', (/** @type {number | null} */ code) => {
      clearTimeout(timer);
      cleanup();
      resolve(code === 0 ? 0 : 1);
    });
  });
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl
 * @param {{ out: (s: string) => void, err: (s: string) => void, spawnImpl?: SpawnImpl }} io
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
  if (argv[0] === 'run') return argv.length === 1 ? runClaude(env, err, io.spawnImpl) : usage('run takes no arguments');
  // Never send a secret's value to the server, never echo it (S21-02).
  if (holdsSecret(argv, env)) return usage('refused: an argument holds the value of a secret variable');
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
