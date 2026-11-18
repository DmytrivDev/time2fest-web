/**
 * `pnpm --dir server realtime:config <--write | --check | --print-env <class>> [--dir <path>]`
 * (SPEC-06 AC-2): the Centrifugo configuration generated from the channel registry. Ring 4 entry point.
 * - `--write` writes `centrifugo.{test,rehearsal,production}.json` (2-space JSON, trailing `\n`) into
 *   `server/realtime/` or `--dir`; it never writes anything else.
 * - `--check` regenerates in memory and compares with the stored files as JSON (line endings do not
 *   matter); a difference names the file and the first differing JSON path.
 * - `--check` also compares the generated test env with the `centrifugo` blocks of `docker-compose.yml` and
 *   `.github/workflows/verify.yml` under `--root` (default: the repository root); secret and engine keys are ignored.
 * - `--check` also asserts that rehearsal and production serve the API and health on the internal port only (S1).
 * - `--print-env <class>` prints the env rendering (`KEY=value` lines) of that class.
 * The generated files hold no secret and no engine address.
 * Exit codes: 0 done / in sync, 1 a stored file differs or is missing, 2 usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centrifugoConfig, centrifugoEnv, hasInternalSplit, type CentrifugoConfig } from '../domain/realtime/centrifugoConfig';
import type { EnvClass } from '../platform/env';
import { channelClassesFor, REALTIME_SITE_ORIGINS } from '../registries/channels';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(serverDir, '..');

/** The default folder of the generated files. */
export const REALTIME_CONFIG_DIR = path.join(serverDir, 'realtime');

export const REALTIME_CLASSES: readonly EnvClass[] = ['test', 'rehearsal', 'production'];

const isClass = (v: string | undefined): v is EnvClass => REALTIME_CLASSES.includes(v as EnvClass);

/** The file name of `cls`'s generated configuration. */
export const configFileName = (cls: EnvClass): string => `centrifugo.${cls}.json`;

/** The generated configuration of `cls`. */
export function generate(cls: EnvClass): CentrifugoConfig {
  return centrifugoConfig(channelClassesFor(cls), cls, REALTIME_SITE_ORIGINS);
}

/** The stored text of a configuration: 2-space JSON with a trailing newline. */
export const renderConfig = (config: CentrifugoConfig): string => `${JSON.stringify(config, null, 2)}\n`;

/** The first JSON path where `actual` differs from `expected`, or `undefined` when they are equal. */
export function firstDifference(expected: unknown, actual: unknown, at = '$'): string | undefined {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return at;
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= expected.length || i >= actual.length) return `${at}[${i}]`;
      const diff = firstDifference(expected[i], actual[i], `${at}[${i}]`);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
  if (isObject(expected) || isObject(actual)) {
    if (!isObject(expected) || !isObject(actual)) return at;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!(key in expected) || !(key in actual)) return `${at}.${key}`;
      const diff = firstDifference(expected[key], actual[key], `${at}.${key}`);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }
  return Object.is(expected, actual) ? undefined : at;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

interface Args {
  mode: 'write' | 'check' | 'print-env' | undefined;
  envClass: string | undefined;
  dir: string;
  root: string;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const args: Args = { mode: undefined, envClass: undefined, dir: REALTIME_CONFIG_DIR, root: repoRoot };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write' || arg === '--check') {
      if (args.mode !== undefined) return undefined;
      args.mode = arg === '--write' ? 'write' : 'check';
    } else if (arg === '--print-env') {
      if (args.mode !== undefined) return undefined;
      args.mode = 'print-env';
      args.envClass = argv[(i += 1)];
    } else if (arg === '--dir') {
      const dir = argv[(i += 1)];
      if (dir === undefined || dir === '') return undefined;
      args.dir = path.resolve(dir);
    } else if (arg === '--root') {
      const root = argv[(i += 1)];
      if (root === undefined || root === '') return undefined;
      args.root = path.resolve(root);
    } else {
      return undefined;
    }
  }
  return args;
}

/** Env keys that differ by design between the stack files and the generated test env. */
const IGNORED_ENV = /^CENTRIFUGO_(CLIENT_TOKEN_HMAC_SECRET_KEY|HTTP_API_KEY|ENGINE_.*)$/;

/** The `CENTRIFUGO_*: value` lines (line-based) inside the `centrifugo:` block of a compose/workflow text. */
export function centrifugoBlockEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let indent = -1;
  for (const line of lines) {
    if (indent < 0) {
      const head = /^(\s*)centrifugo:\s*$/.exec(line);
      if (head) indent = (head[1] ?? '').length;
      continue;
    }
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if ((/^\s*/.exec(line)?.[0] ?? '').length <= indent) break;
    const m = /^\s+(CENTRIFUGO_[A-Z0-9_]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2] ?? '';
    if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    else if (/^".*"$/.test(value)) value = value.slice(1, -1);
    out.set(m[1] ?? '', value);
  }
  return out;
}

/** Compares the generated test env with the stack files; returns the number of problems. */
function checkStackEnv(root: string, io: CliIo): number {
  const expected = centrifugoEnv(generate('test'));
  let problems = 0;
  for (const rel of ['docker-compose.yml', '.github/workflows/verify.yml']) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      io.err(`realtime:config: ${file} is missing`);
      problems += 1;
      continue;
    }
    const actual = centrifugoBlockEnv(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of expected) {
      if (IGNORED_ENV.test(key)) continue;
      if (actual.get(key) !== value) {
        io.err(`realtime:config: ${rel} ${key} ${actual.has(key) ? 'differs from' : 'is missing next to'} the generated test env`);
        problems += 1;
      }
    }
  }
  return problems;
}

function check(dir: string, root: string, io: CliIo): number {
  let code = 0;
  for (const cls of REALTIME_CLASSES) {
    const file = path.join(dir, configFileName(cls));
    if (!fs.existsSync(file)) {
      io.err(`realtime:config: ${file} is missing — run pnpm --dir server realtime:config --write`);
      code = 1;
      continue;
    }
    let stored: unknown;
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      io.err(`realtime:config: ${file} is not valid JSON`);
      code = 1;
      continue;
    }
    if (cls !== 'test' && !hasInternalSplit(generate(cls))) {
      io.err(`realtime:config: ${configFileName(cls)} serves the API and health on the public port — http_server.internal_port is required`);
      code = 1;
    }
    const diff = firstDifference(generate(cls), stored);
    if (diff !== undefined) {
      io.err(`realtime:config: ${file} differs from the registry at ${diff} — run pnpm --dir server realtime:config --write`);
      code = 1;
    }
  }
  if (checkStackEnv(root, io) > 0) code = 1;
  if (code === 0) io.out(`realtime:config: ${REALTIME_CLASSES.length} files in sync, stack env in sync`);
  return code;
}

function write(dir: string, io: CliIo): number {
  fs.mkdirSync(dir, { recursive: true });
  for (const cls of REALTIME_CLASSES) {
    const file = path.join(dir, configFileName(cls));
    fs.writeFileSync(file, renderConfig(generate(cls)));
    io.out(`realtime:config: wrote ${file}`);
  }
  return 0;
}

const USAGE = 'usage: realtime:config <--write | --check | --print-env <test|rehearsal|production>> [--dir <path>] [--root <path>]';

/** Runs the CLI with `argv` (without the node and script paths); returns the exit code. */
export function runRealtimeConfig(argv: readonly string[], io: CliIo): number {
  const args = parseArgs(argv);
  if (args === undefined || args.mode === undefined) {
    io.err(USAGE);
    return 2;
  }
  if (args.mode === 'write') return write(args.dir, io);
  if (args.mode === 'check') return check(args.dir, args.root, io);
  if (!isClass(args.envClass)) {
    io.err(USAGE);
    return 2;
  }
  for (const [name, value] of centrifugoEnv(generate(args.envClass))) io.out(`${name}=${value}`);
  return 0;
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const io: CliIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
  try {
    process.exitCode = runRealtimeConfig(process.argv.slice(2), io);
  } catch (err: unknown) {
    io.err(`realtime:config: failed (${err instanceof Error ? err.message : 'error'})`);
    process.exitCode = 1;
  }
}
