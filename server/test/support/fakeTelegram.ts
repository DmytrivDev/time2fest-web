/**
 * The Telegram fake for server tests (SPEC-13b W15): starts `fakes/telegram/server.mjs` on 127.0.0.1, port 0, and
 * gives the env a server under test needs to send there (`T2F_TELEGRAM_API_BASE`, the test token, a made-up test
 * chat id). Never reaches `api.telegram.org`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeTelegram } from '../../../fakes/telegram/server.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const TEST_TELEGRAM_TOKEN = 'test-telegram-token-not-real'; // check-secrets: allow test fake
export const TEST_TELEGRAM_CHAT_ID = '-1000000000042';

export interface FakeTelegramCall {
  path: string;
  chat_id: unknown;
  text: unknown;
  disable_web_page_preview: unknown;
  parse_mode?: unknown;
  tokenMatches: boolean;
  at: string;
}

export interface FakeTelegramHandle {
  url: string;
  /** Env of a server under test that sends to this fake. */
  env: Record<string, string>;
  calls(): Promise<FakeTelegramCall[]>;
  /** Calls whose text contains `needle`. */
  callsWith(needle: string): Promise<FakeTelegramCall[]>;
  down(on: boolean): Promise<void>;
  mode(mode: string, opts?: { retryAfter?: number; times?: number }): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

async function control(url: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`fake telegram ${path}: ${res.status}`);
  return res.json();
}

export async function startTelegramFake(): Promise<FakeTelegramHandle> {
  const fake = await startFakeTelegram({ port: 0, token: TEST_TELEGRAM_TOKEN });
  const url = fake.url.replace(/\/$/, '');
  const calls = async () => ((await control(url, '/_control/calls')) as { calls: FakeTelegramCall[] }).calls;
  return {
    url,
    env: { T2F_TELEGRAM_API_BASE: url, T2F_TELEGRAM_BOT_TOKEN: TEST_TELEGRAM_TOKEN, T2F_TELEGRAM_TEST_CHAT_ID: TEST_TELEGRAM_CHAT_ID },
    calls,
    callsWith: async (needle) => (await calls()).filter((c) => typeof c.text === 'string' && c.text.includes(needle)),
    down: async (on) => void (await control(url, '/_control/down', { on })),
    mode: async (mode, opts = {}) => void (await control(url, '/_control/mode', { mode, ...opts })),
    reset: async () => void (await control(url, '/_control/reset', {})),
    close: () => fake.close(),
  };
}

/** A child process running `test/support/alarm-instance.ts` (its own container, alarm and ops runner). */
export interface AlarmInstance {
  proc: ChildProcessWithoutNullStreams;
  raise(level: 'page' | 'log', source: string, code: string): void;
  offset(ms: number): void;
  /** Graceful stop: the lease is released. */
  stop(): Promise<void>;
  /** The crash: SIGKILL, nothing released. */
  kill(): Promise<void>;
}

/** Spawns an instance with `env` added to this process's env; resolves once it prints `READY`. */
export function spawnAlarmInstance(tag: string, env: Record<string, string>, readyTimeoutMs = 120_000): Promise<AlarmInstance> {
  const proc = spawn(process.execPath, [path.join(serverDir, 'node_modules/tsx/dist/cli.mjs'), 'test/support/alarm-instance.ts', tag], {
    cwd: serverDir,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
  const exited = () => proc.exitCode !== null || proc.signalCode !== null;
  const waitExit = () => new Promise<void>((r) => (exited() ? r() : proc.once('exit', () => r())));
  const inst: AlarmInstance = {
    proc,
    raise: (level, source, code) => void proc.stdin.write(`RAISE ${level} ${source} ${code}
`),
    offset: (ms) => void proc.stdin.write(`OFFSET ${ms}
`),
    async stop() {
      if (exited()) return;
      const done = waitExit();
      proc.stdin.end();
      const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
      await done;
      clearTimeout(timer);
    },
    async kill() {
      if (exited()) return;
      const done = waitExit();
      proc.kill('SIGKILL');
      await done;
    },
  };
  return new Promise((resolve, reject) => {
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`alarm instance ${tag}: not ready; ${stderr.slice(-500)}`));
    }, readyTimeoutMs);
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      if (buffer.includes(`READY ${tag}`)) {
        clearTimeout(timer);
        resolve(inst);
      }
      if (buffer.length > 10_000) buffer = buffer.slice(-1_000);
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`alarm instance ${tag} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
