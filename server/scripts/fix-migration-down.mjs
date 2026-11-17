// @ts-check
/**
 * Post-generate fixer for Payload migrations (see `lib/migrationDown.mjs` for why).
 *
 * Run it right after `pnpm --dir server migrate:create <name>`, from `server/`:
 *   node scripts/fix-migration-down.mjs src/migrations/<file>.ts   # one or more files
 *   node scripts/fix-migration-down.mjs                            # every migration not on master
 *
 * Only the `down` function changes; `up` is never touched. A migration that exists on `master`
 * is refused (merged migrations are never edited). Idempotent: a second run changes nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixMigrationDown } from './lib/migrationDown.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(serverDir, 'src', 'migrations');

/** @param {string} abs */
function onMaster(abs) {
  const rel = path.relative(path.join(serverDir, '..'), abs).split(path.sep).join('/');
  try {
    execFileSync('git', ['cat-file', '-e', `master:${rel}`], { cwd: serverDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => path.resolve(process.cwd(), a))
  : fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d{8}_\d{6}_.+\.ts$/.test(f))
      .map((f) => path.join(migrationsDir, f))
      .filter((f) => !onMaster(f));

let failed = false;
for (const file of files) {
  if (onMaster(file)) {
    console.error(`refused (on master): ${path.basename(file)}`);
    failed = true;
    continue;
  }
  const { text, changed } = fixMigrationDown(fs.readFileSync(file, 'utf8'));
  if (changed) fs.writeFileSync(file, text);
  console.log(`${path.basename(file)}: ${changed} statement(s) rewritten`);
}
process.exit(failed ? 1 : 0);
