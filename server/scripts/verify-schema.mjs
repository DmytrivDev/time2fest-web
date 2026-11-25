// @ts-check
/**
 * Schema check (SPEC-02 AC-63): (a) no pending migration, (b) payload-types.ts and (c) importMap.js
 * are what the generators produce now. Exits 1 listing the problems.
 * `payload migrate:status` always exits 0, so (a) compares migration names with payload_migrations.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payloadBin = path.join(serverDir, 'node_modules', 'payload', 'bin.js');
const problems = [];

/** @param {string} file */
function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Content equality ignoring line endings (CRLF vs LF).
 * @param {string | null} a
 * @param {string | null} b
 */
function sameContent(a, b) {
  return a !== null && b !== null && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

/** @param {string[]} args */
function payload(args) {
  const r = spawnSync(process.execPath, [payloadBin, ...args], { cwd: serverDir, encoding: 'utf8' });
  if (r.status !== 0) problems.push(`payload ${args.join(' ')} failed: ${(r.stderr || r.stdout).slice(-300)}`);
}

// (a) pending migrations
const indexSrc = fs.readFileSync(path.join(serverDir, 'src/migrations/index.ts'), 'utf8');
const expected = [...indexSrc.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
const envText = read(path.join(serverDir, '.env.local')) ?? '';
const uri = process.env.DATABASE_URI ?? /^DATABASE_URI=(.+)$/m.exec(envText)?.[1]?.trim();
if (!uri) {
  problems.push('DATABASE_URI is not set');
} else {
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();
    const r = await client.query('SELECT name FROM payload_migrations');
    const applied = new Set(r.rows.map((row) => row.name));
    const missing = expected.filter((n) => !applied.has(n));
    if (missing.length > 0) problems.push(`pending migrations: ${missing.join(', ')}`);
  } catch (e) {
    problems.push(`cannot read payload_migrations: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// (b) types and (c) import map: regenerate, compare with the file as it was.
/** @type {[string, string[]][]} */
const generated = [
  ['src/payload-types.ts', ['generate:types']],
  ['src/app/(payload)/admin/importMap.js', ['generate:importmap']],
];
for (const [rel, args] of generated) {
  const file = path.join(serverDir, rel);
  const before = read(file);
  payload(args);
  const after = read(file);
  if (before !== null && after !== null && before !== after && sameContent(before, after)) {
    // Only line endings differ (git autocrlf checkout vs. LF generator output): keep the checked-out bytes.
    fs.writeFileSync(file, before);
  } else if (before === null || after === null || !sameContent(before, after)) {
    problems.push(`${rel} was stale; regenerated — review and keep the new content`);
  }
}

// (d) Better Auth tables/columns (SPEC-10 AC-57): `getMigrations` must have nothing left to create or add.
if (uri) {
  const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const r = spawnSync(process.execPath, [tsx, 'src/cli/authSchemaCheck.ts'], {
    cwd: serverDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URI: uri },
  });
  if (r.status !== 0) {
    const lines = (r.stderr || r.stdout).split(/\r?\n/).filter((l) => l.startsWith('auth schema:'));
    problems.push(...(lines.length > 0 ? lines : [`auth schema check failed: ${(r.stderr || r.stdout).slice(-300)}`]));
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`schema: ${p}`);
  process.exit(1);
}
console.log('schema: migrations applied, types and import map current');
