// @ts-check
/**
 * Contract runner (SPEC-02 W23): one row per domain, sim and http columns.
 *   node scripts/contract-run.mjs [--sim-only]
 * Sim: vitest over tests/unit/api. Http: tests/contract/<domain>.http.test.ts against this worktree's server.
 * Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorktree } from '../server/scripts/lib/worktree.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simOnly = process.argv.includes('--sim-only');
const IS_WIN = process.platform === 'win32';

/** @param {string} dir @returns {string[]} */
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

/** @type {Set<string>} */
const domains = new Set();
for (const f of list(path.join(root, 'tests', 'unit', 'api'))) {
  const m = /^(.+?)-(?:sim|contract)\.test\.tsx?$/.exec(f);
  if (m?.[1]) domains.add(m[1]);
}
/** @type {Set<string>} */
const httpDomains = new Set();
for (const f of list(path.join(root, 'tests', 'contract'))) {
  const m = /^(.+)\.http\.test\.ts$/.exec(f);
  if (m?.[1]) {
    domains.add(m[1]);
    httpDomains.add(m[1]);
  }
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function vitest(args, env = process.env) {
  return spawnSync('npx', ['vitest', 'run', ...args], { cwd: root, encoding: 'utf8', shell: IS_WIN, env });
}

// Sim: one JSON run, mapped per domain by file name.
const tmp = path.join(os.tmpdir(), `t2f-contract-sim-${process.pid}.json`);
vitest(['tests/unit/api', '--maxWorkers=2', '--reporter=json', `--outputFile=${tmp}`]);
/** @type {Map<string, boolean>} */
const simOk = new Map();
try {
  const json = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  for (const file of json.testResults ?? []) {
    const m = /[\\/]tests[\\/]unit[\\/]api[\\/](.+?)-(?:sim|contract|hooks)\.test\.tsx?$/.exec(file.name);
    const d = m?.[1];
    if (!d) continue;
    simOk.set(d, (simOk.get(d) ?? true) && file.status === 'passed');
  }
} finally {
  fs.rmSync(tmp, { force: true });
}

const serverUrl =
  process.env.T2F_SERVER_URL ?? `http://127.0.0.1:${resolveWorktree(root, process.env).ports.server}`;

/** @type {Array<[string, string, string]>} */
const rows = [];
let failed = false;
for (const d of [...domains].sort()) {
  const sim = simOk.has(d) ? (simOk.get(d) ? 'pass' : 'FAIL') : 'no suite';
  if (sim === 'FAIL') failed = true;
  let http;
  if (simOnly) {
    http = 'skipped (sim-only)';
  } else if (!httpDomains.has(d)) {
    http = 'skipped (no server)';
  } else {
    const r = vitest(['-c', 'tests/contract/vitest.http.config.ts', `tests/contract/${d}.http.test.ts`], {
      ...process.env,
      T2F_SERVER_URL: serverUrl,
    });
    http = r.status === 0 ? 'pass' : 'FAIL';
    if (r.status !== 0) {
      failed = true;
      console.error((r.stdout + r.stderr).split('\n').slice(-30).join('\n'));
    }
  }
  rows.push([d, sim, http]);
}

console.log('domain | sim | http');
for (const r of rows) console.log(r.join(' | '));
process.exit(failed ? 1 : 0);
