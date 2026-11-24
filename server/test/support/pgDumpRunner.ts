/**
 * `pg_dump` for integration tests (SPEC-13b [П-8]): the local binary when its major is 17 (the production
 * adapter itself), else `pg_dump` inside the shared `postgres` container of the `t2f` compose project
 * (`docker compose -p t2f exec -T postgres pg_dump …`, connecting to 127.0.0.1:5432 inside the container).
 * The password reaches the child only as `PGPASSWORD` in its environment (`-e PGPASSWORD` without a value
 * forwards it), never on a command line.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_DUMP_ARGS, createPgDumpRunner, parsePgDumpVersion, pgEnvOf, runForOutput, streamOf } from '../../src/adapters/pgDump';
import { PG_RESTORE_ARGS, createPgRestoreRunner, runRestoreSpec } from '../../src/cli/ops';
import type { DumpRunner } from '../../src/ops/ports';
import type { RestoreRunner } from '../../src/ops/restorePull';

const COMPOSE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docker-compose.yml');
const REQUIRED_MAJOR = 17;

function dockerSpec(databaseUri: string, args: readonly string[]) {
  const pg = pgEnvOf(databaseUri);
  return {
    cmd: 'docker',
    args: [
      'compose', '-p', 't2f', '-f', COMPOSE_FILE, 'exec', '-T',
      '-e', 'PGPASSWORD', '-e', 'PGUSER', '-e', 'PGDATABASE', '-e', 'PGHOST=127.0.0.1', '-e', 'PGPORT=5432',
      'postgres', 'pg_dump', ...args,
    ],
    env: { ...pg, PGHOST: '127.0.0.1', PGPORT: '5432' },
  };
}

/** The runner of this machine: local `pg_dump` 17, else the container's. */
export async function testDumpRunner(databaseUri: string, serverVersion: () => Promise<number>): Promise<DumpRunner> {
  const local = createPgDumpRunner({ databaseUri, serverVersion });
  const major = await local.version().catch(() => Number.NaN);
  if (major === REQUIRED_MAJOR) return local;
  return {
    async version() {
      return parsePgDumpVersion(await runForOutput(dockerSpec(databaseUri, ['--version']), 60_000));
    },
    serverVersion,
    dump: () => streamOf(dockerSpec(databaseUri, PG_DUMP_ARGS)),
  };
}

/**
 * `pg_restore` for integration tests (SPEC-13b W37): the local binary when its major is 17 (the command's own
 * adapter), else `pg_restore` inside the stack's `postgres` container, stdin piped through `exec -T`.
 */
export async function testRestoreRunner(databaseUri: string): Promise<RestoreRunner> {
  const local = await runForOutput({ cmd: 'pg_restore', args: ['--version'], env: {} }).then(parsePgDumpVersion, () => Number.NaN);
  if (local === REQUIRED_MAJOR) return createPgRestoreRunner(databaseUri);
  const db = pgEnvOf(databaseUri).PGDATABASE ?? '';
  const spec = dockerSpec(databaseUri, []);
  const args = spec.args.slice(0, -1).concat(['pg_restore', ...PG_RESTORE_ARGS, '-d', db]);
  return { restore: (input) => runRestoreSpec({ ...spec, args }, input) };
}
