/**
 * `pnpm run site:prepared` (SPEC-08 AC-42): reads the current `site` snapshot, writes the prepared technical
 * file — the state with `outage: 'technical'` — to stdout and, when the environment has a bucket, to
 * `<prefix>site/prepared/technical.json`. Ring 4 entry point; the body is the only thing printed to stdout.
 * Exit codes: 0 done, 1 failed (no catalog season, store down). No environment value is ever printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_R2_KEYS, type SiteState } from '@time2fest/contracts';
import { technicalOf } from '../domain/site/snapshot';
import type { SnapshotReadDeps } from '../site/snapshot';
import { readSnapshot } from '../site/snapshot';
import type { ObjectStore } from '../catalog/ports';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The pure part: the file body and its bucket key (`null` without a bucket prefix). */
export function preparedFile(state: SiteState, prefix: string | null): { body: string; key: string | null } {
  return { body: JSON.stringify(technicalOf(state)), key: prefix === null ? null : `${prefix}${SITE_R2_KEYS.prepared}` };
}

export interface SitePreparedPorts {
  snapshot: SnapshotReadDeps;
  /** The bucket the copy goes to, when the environment has one. */
  bucket?: { objects: Pick<ObjectStore, 'put'>; prefix: string };
  close(): Promise<void>;
}

export interface SitePreparedIo {
  out(line: string): void;
  err(line: string): void;
}

export async function runSitePrepared(io: SitePreparedIo, open: () => Promise<SitePreparedPorts>): Promise<number> {
  const ports = await open();
  try {
    const read = await readSnapshot(ports.snapshot);
    if (!read.ok) {
      io.err(`site:prepared: no snapshot (${read.reason})`);
      return 1;
    }
    const file = preparedFile(read.state, ports.bucket?.prefix ?? null);
    io.out(file.body);
    if (ports.bucket && file.key) await ports.bucket.objects.put(file.key, file.body, 'application/json');
    return 0;
  } finally {
    await ports.close();
  }
}

async function openPorts(): Promise<SitePreparedPorts> {
  const [{ createDeps, payloadOf, siteFanOutDepsOf }] = await Promise.all([import('../container')]);
  const deps = createDeps(process.env);
  const fan = siteFanOutDepsOf(deps);
  const payload = payloadOf(deps);
  return {
    snapshot: fan.snapshot,
    ...(fan.copy ? { bucket: { objects: fan.copy.objects, prefix: fan.copy.prefix } } : {}),
    close: () =>
      payload()
        .then((p) => p.destroy())
        .catch(() => undefined),
  };
}

async function main(): Promise<number> {
  const envFile = path.join(serverDir, '.env.local');
  if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  return runSitePrepared({ out: (l) => process.stdout.write(`${l}\n`), err: (l) => process.stderr.write(`${l}\n`) }, openPorts);
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      // The error name only: a message may carry a connection string.
      process.stderr.write(`site:prepared: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.exit(1);
    },
  );
}
