/**
 * `pnpm --dir server import <domain> [--apply] [--source-dir <dir>]` (AC-75, AC-79, AC-80): imports the
 * data files of a domain. Ring 4 entry point.
 * - Without `--apply` it is a dry run: the report only, nothing is written.
 * - The source directory defaults to `../data` (the repository's `data/`).
 * - An unknown domain exits with 2 and lists the known ones.
 * - It runs in every environment class and never loads the test doors.
 * Exit codes: 0 done, 1 failed (a source file that fails its schema is named with the field path), 2 usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRegistry, type ImportRow } from '../registries/imports';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface ImportArgs {
  domain: string | undefined;
  apply: boolean;
  sourceDir: string;
}

export function parseArgs(argv: readonly string[]): ImportArgs {
  let domain: string | undefined;
  let apply = false;
  let sourceDir = path.resolve(serverDir, '../data');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--source-dir') sourceDir = path.resolve(argv[(i += 1)] ?? '');
    else if (arg !== undefined && !arg.startsWith('--') && domain === undefined) domain = arg;
  }
  return { domain, apply, sourceDir };
}

/** The row for `domain`, or the usage text (known domains listed) and exit code 2. */
export function pickDomain(domain: string | undefined, rows: readonly Pick<ImportRow, 'key'>[]): { ok: true; key: string } | { ok: false; message: string } {
  const known = rows.map((r) => r.key);
  if (domain !== undefined && known.includes(domain)) return { ok: true, key: domain };
  const what = domain === undefined ? 'no domain given' : `unknown domain ${JSON.stringify(domain)}`;
  return { ok: false, message: `import: ${what}; known domains: ${known.join(', ')}` };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const picked = pickDomain(args.domain, importRegistry);
  if (!picked.ok) {
    process.stderr.write(`${picked.message}\n`);
    return 2;
  }
  const row = importRegistry.find((r) => r.key === picked.key);
  if (!row) return 2;
  const envFile = path.join(serverDir, '.env.local');
  // The local file only fills in a shell that has no database configured (a deployed run brings its own environment).
  if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { createDeps } = await import('../container');
  const deps = createDeps(process.env);
  const readSource = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(args.sourceDir, file), 'utf8'));
  const started = deps.clock.now();
  try {
    const result = await row.run({ apply: args.apply, deps, readSource });
    (result.code === 0 ? process.stdout : process.stderr).write(`${result.lines.join('\n')}\n`);
    process.stdout.write(`import ${row.key}: ${args.apply ? 'apply' : 'dry run'} took ${Math.round(deps.clock.now() - started)} ms\n`);
    return result.code;
  } finally {
    const { payloadOf } = await import('../container');
    await payloadOf(deps)()
      .then((p) => p.destroy())
      .catch(() => undefined);
  }
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`import: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.exit(1);
    },
  );
}
