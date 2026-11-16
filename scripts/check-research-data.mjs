// @ts-check
/**
 * `research_data` path check (SPEC-02 W25): no tracked code under server, packages, tests or scripts/seed
 * may reference `research_data` (it holds real visitor data and must never ship). Exit 1 on a hit.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.env.T2F_CHECK_ROOT ? path.resolve(process.env.T2F_CHECK_ROOT) : root;

const r = spawnSync('git', ['grep', '-n', 'research_data', '--', 'server', 'packages', 'tests', 'scripts/seed'], {
  cwd,
  encoding: 'utf8',
});
if (r.status === 0) {
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    const m = /^([^:]+:\d+):/.exec(line);
    console.log(`${m ? m[1] : line} research_data`);
  }
  console.error('check-research-data: references found');
  process.exit(1);
}
if (r.status !== 1) {
  console.error(`check-research-data: git grep failed (${r.status})`);
  process.exit(2);
}
console.log('check-research-data: clean');
