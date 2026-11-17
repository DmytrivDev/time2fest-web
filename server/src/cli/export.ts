/**
 * `pnpm --dir server export catalog --from <base url | db> [--out <dir>] [--write]` (AC-82, AC-83): the
 * catalog back to the data files. Ring 4 entry point.
 * - `--from db` reads the configured database; a base URL reads its `/api/catalog`.
 * - `--out` defaults to `../data`. Without `--write` it only prints which files would change.
 * - With `--write` it refuses while a target has uncommitted changes in git.
 * Exit codes: 0 done, 1 failed, 2 usage, 3 refused (uncommitted changes).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogResponseSchema } from '@time2fest/contracts/schemas';
import { exportCatalog, type ExportFile, type ExportPorts } from '../catalog/export';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface ExportArgs {
  domain: string | undefined;
  from: string | undefined;
  out: string;
  write: boolean;
}

export function parseArgs(argv: readonly string[]): ExportArgs {
  let domain: string | undefined;
  let from: string | undefined;
  let write = false;
  let out = path.resolve(serverDir, '../data');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') write = true;
    else if (arg === '--from') from = argv[(i += 1)];
    else if (arg === '--out') out = path.resolve(argv[(i += 1)] ?? '');
    else if (arg !== undefined && !arg.startsWith('--') && domain === undefined) domain = arg;
  }
  return { domain, from, out, write };
}

/** `git status --porcelain` over the targets; a directory that is not a repository has nothing to protect. */
export function gitDirty(dir: string, files: readonly ExportFile[]): string[] {
  if (files.length === 0) return [];
  const r = spawnSync('git', ['-C', dir, 'status', '--porcelain', '--', ...files], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(3));
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.domain !== 'catalog' || args.from === undefined) {
    process.stderr.write('export: usage: export catalog --from <base url | db> [--out <dir>] [--write]; known domains: catalog\n');
    return 2;
  }
  const from = args.from;
  const isUrl = /^https?:\/\//.test(from);
  if (!isUrl && from !== 'db') {
    process.stderr.write('export: --from must be "db" or an http(s) base URL\n');
    return 2;
  }
  let cleanup: (() => Promise<void>) | undefined;
  let source: ExportPorts['source'];
  if (isUrl) {
    source = async () => {
      const res = await fetch(`${from.replace(/\/+$/, '')}/api/catalog`);
      return CatalogResponseSchema.parse(await res.json()) as Awaited<ReturnType<ExportPorts['source']>>;
    };
  } else {
    const envFile = path.join(serverDir, '.env.local');
    if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);
    const { createDeps, catalogStoreOf, payloadOf } = await import('../container');
    const { readCatalog } = await import('../catalog/service');
    const deps = createDeps(process.env);
    source = () => readCatalog(catalogStoreOf(deps));
    cleanup = () =>
      payloadOf(deps)()
        .then((p) => p.destroy())
        .catch(() => undefined);
  }
  const target = (file: ExportFile) => path.join(args.out, file);
  try {
    const result = await exportCatalog(
      {
        source,
        readTarget: (file) => (fs.existsSync(target(file)) ? fs.readFileSync(target(file), 'utf8') : undefined),
        writeTarget: (file, text) => fs.writeFileSync(target(file), text),
        dirtyTargets: (files) => gitDirty(args.out, files),
      },
      { write: args.write },
    );
    (result.code === 0 ? process.stdout : process.stderr).write(`${result.lines.join('\n')}\n`);
    return result.code;
  } finally {
    await cleanup?.();
  }
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`export: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.exit(1);
    },
  );
}
