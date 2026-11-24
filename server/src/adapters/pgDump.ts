/**
 * `pg_dump` of the environment's database (SPEC-13b [П-8], AC-41, AC-42, NFR-3, NFR-4), ring 4.
 *
 * - The connection goes ONLY through the child's environment (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
 *   `PGDATABASE`): the argv is `pg_dump --format=custom --no-owner`, so the password never reaches a process list
 *   or a log. Errors name the exit code only; `pg_dump`'s stderr is counted, never logged.
 * - Low priority: `nice -n 10` on POSIX (skipped on win32), NFR-3.
 * - `dump()` streams stdout with back-pressure; the stream ends only after the child exited 0, otherwise it is
 *   destroyed with an error — a dump cut short is never mistaken for a whole one. Destroying the stream kills the
 *   child.
 * - The server's major version is read through the caller's `serverVersion` (the app's own pool), not `psql`.
 */
import { spawn } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import type { DumpRunner } from '../ops/ports';

/** A spawn spec: command, argv and the extra child environment. */
export interface DumpCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

/** Connection parts of a `postgres://` URI as libpq environment variables. */
export function pgEnvOf(databaseUri: string): Record<string, string> {
  const u = new URL(databaseUri);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('pg_dump: DATABASE_URI is not a postgres URI');
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

/** Major version from `pg_dump (PostgreSQL) 17.2` / `pg_dump (PostgreSQL) 17.12 (Debian …)`; NaN when unknown. */
export function parsePgDumpVersion(out: string): number {
  const m = /\(PostgreSQL\)\s+(\d+)(?:\.\d+)?/.exec(out);
  return m ? Number(m[1]) : Number.NaN;
}

/** The arguments of the custom-format dump; connection is in the environment only. */
export const PG_DUMP_ARGS: readonly string[] = ['--format=custom', '--no-owner'];

/** Runs `spec` and answers its stdout (the version probe); a non-zero exit rejects with the code only. */
export function runForOutput(spec: DumpCommand, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.cmd, spec.args, { env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`pg_dump: cannot start ${spec.cmd} (${(err as NodeJS.ErrnoException).code ?? 'error'})`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`pg_dump: ${spec.cmd} exited with ${String(code)}`));
    });
  });
}

/** Streams the stdout of `spec`; ends after exit 0, else errors (code only). Destroying the result kills the child. */
export function streamOf(spec: DumpCommand): Readable {
  const out = new PassThrough();
  const child = spawn(spec.cmd, spec.args, { env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderrBytes = 0;
  // Drained (never logged: libpq messages may name the host or user), so a chatty child never blocks.
  child.stderr.on('data', (d: Buffer) => (stderrBytes += d.length));
  child.stdout.pipe(out, { end: false });
  child.on('error', (err) => out.destroy(new Error(`pg_dump: cannot start ${spec.cmd} (${(err as NodeJS.ErrnoException).code ?? 'error'})`)));
  child.on('close', (code, signal) => {
    if (out.destroyed) return;
    if (code === 0) out.end();
    else out.destroy(new Error(`pg_dump: exited with ${code === null ? String(signal) : String(code)} (stderr ${stderrBytes} bytes)`));
  });
  out.on('close', () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return out;
}

export interface PgDumpRunnerOptions {
  databaseUri: string;
  /** Major version of the database server (the app's pool, `server_version_num`). */
  serverVersion(): Promise<number>;
  /** The `pg_dump` binary (default `pg_dump` on PATH; the image installs PostgreSQL 17 client, [П-1]). */
  bin?: string;
  platform?: NodeJS.Platform;
}

/** The production runner: the local `pg_dump` binary, `nice`d on POSIX. */
export function createPgDumpRunner(opts: PgDumpRunnerOptions): DumpRunner {
  const bin = opts.bin ?? 'pg_dump';
  const nice = (opts.platform ?? process.platform) !== 'win32';
  return {
    async version() {
      return parsePgDumpVersion(await runForOutput({ cmd: bin, args: ['--version'], env: {} }));
    },
    serverVersion: () => opts.serverVersion(),
    dump() {
      const env = pgEnvOf(opts.databaseUri);
      return streamOf(nice ? { cmd: 'nice', args: ['-n', '10', bin, ...PG_DUMP_ARGS], env } : { cmd: bin, args: [...PG_DUMP_ARGS], env });
    },
  };
}
