// @ts-check
// Вузли прогону спайку за одним інтерфейсом: віддалений (SSH root на вузол спайку, Linux) і локальний (Docker на цій
// машині, для сухого прогону без DigitalOcean і Cloudflare). Команди — argv без оболонки локально; на вузлі — argv,
// кожен елемент якого точно дозволено (`allow`), як у `infra/ops/lib/exec.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { COMPOSE_FILE, NODE_DIR, PROJECT } from './config.mjs';

/**
 * @typedef {import('../../lib/exec.mjs').Transport} Transport
 * @typedef {import('../../lib/exec.mjs').RunResult} RunResult
 * @typedef {(file: string, args: string[], opts?: { timeoutMs?: number, input?: string }) => Promise<RunResult>} LocalRun
 * @typedef {{
 *   name: string,
 *   kind: 'remote' | 'local',
 *   dir: string,
 *   path: (rel: string) => string,
 *   writeFile: (rel: string, text: string) => Promise<void>,
 *   readFile: (rel: string) => Promise<string | null>,
 *   lastLine: (rel: string) => Promise<string>,
 *   docker: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>,
 *   compose: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>,
 *   startCollector: (container: string) => Promise<void>,
 *   stopCollector: () => Promise<void>,
 *   prepareOut: () => Promise<void>,
 * }} FleetNode
 */

const TIMEOUT = 120_000;

/**
 * Вузол спайку через SSH (root). Каталог — `/srv/t2f/spike`.
 * @param {string} name
 * @param {Transport} t
 * @returns {FleetNode}
 */
export function remoteNode(name, t) {
  const dir = NODE_DIR;
  /** @param {string[]} argv @param {{ input?: string, timeoutMs?: number }} [o] */
  const run = (argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? TIMEOUT, ...(o.input !== undefined ? { input: o.input } : {}) });
  /** @param {string} rel */
  const p = (rel) => `${dir}/${rel}`;
  /** @param {string[]} args @param {{ timeoutMs?: number }} [o] */
  const docker = (args, o) => run(['docker', ...args], o);
  return {
    name,
    kind: 'remote',
    dir,
    path: p,
    async writeFile(rel, text) {
      const r = await run(['sh', '-c', 'set -e; umask 077; mkdir -p "$(dirname "$1")"; cat > "$1.tmp"; mv "$1.tmp" "$1"', '_', p(rel)], { input: text });
      if (r.code !== 0) throw new Error(`${name}: ${rel} не записано (код ${r.code})`);
    },
    async readFile(rel) {
      const r = await run(['cat', p(rel)], { timeoutMs: 300_000 });
      return r.code === 0 ? r.stdout : null;
    },
    async lastLine(rel) {
      const r = await run(['tail', '-n', '1', p(rel)]);
      return r.code === 0 ? r.stdout.trim() : '';
    },
    docker,
    compose: (args, o) => docker(['compose', '-p', PROJECT, '-f', p(COMPOSE_FILE), '--project-directory', dir, ...args], o),
    async startCollector(container) {
      const r = await run([
        'sh',
        '-c',
        // pid — у файлі (pkill -f зачепив би й цю саму оболонку, бо в її рядку є ім’я скрипту).
        'cd "$1" && { [ -f collector.pid ] && kill "$(cat collector.pid)" 2>/dev/null; true; } && rm -f out/collector.jsonl && ' +
          '{ nohup sh collector/rtspike-collector.sh out/collector.jsonl 10 "$2" </dev/null >/dev/null 2>&1 & echo $! > collector.pid; }',
        '_',
        dir,
        container,
      ]);
      if (r.code !== 0) throw new Error(`${name}: збирач не запущено (код ${r.code})`);
    },
    async stopCollector() {
      await run(['sh', '-c', 'cd "$1" && [ -f collector.pid ] && kill "$(cat collector.pid)" 2>/dev/null; rm -f "$1/collector.pid"; true', '_', dir]);
    },
    async prepareOut() {
      // k6 у контейнері працює не від root: тека виводу має бути доступна на запис.
      const r = await run(['sh', '-c', 'set -e; mkdir -p "$1/out" "$1/k6" "$1/collector"; chmod 777 "$1/out"; rm -f "$1"/out/*.json "$1"/out/*.jsonl', '_', dir]);
      if (r.code !== 0) throw new Error(`${name}: тека виводу не підготовлена (код ${r.code})`);
    },
  };
}

/**
 * Локальний «вузол»: Docker цієї машини, каталог — `infra/ops/.local/spike/local`. Збирач — служба `collector` профілю.
 * @param {string} dir
 * @param {LocalRun} runLocal
 * @returns {FleetNode}
 */
export function localNode(dir, runLocal) {
  /** @param {string} rel */
  const p = (rel) => path.join(dir, ...rel.split('/'));
  /** @param {string[]} args @param {{ timeoutMs?: number }} [o] */
  const docker = (args, o = {}) => runLocal('docker', args, { timeoutMs: o.timeoutMs ?? TIMEOUT });
  /** @param {string[]} args @param {{ timeoutMs?: number }} [o] */
  const compose = (args, o) => docker(['compose', '-p', PROJECT, '-f', p(COMPOSE_FILE), '--project-directory', dir, ...args], o);
  return {
    name: 'local',
    kind: 'local',
    dir,
    path: p,
    async writeFile(rel, text) {
      fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
      fs.writeFileSync(p(rel), text, { mode: 0o600 });
    },
    async readFile(rel) {
      try {
        return fs.readFileSync(p(rel), 'utf8');
      } catch {
        return null;
      }
    },
    async lastLine(rel) {
      try {
        return fs.readFileSync(p(rel), 'utf8').trim().split(/\r?\n/).pop() ?? '';
      } catch {
        return '';
      }
    },
    docker,
    compose,
    async startCollector() {
      fs.rmSync(p('out/collector.jsonl'), { force: true });
      const r = await compose(['--profile', 'collector', 'up', '-d', '--force-recreate', 'collector']);
      if (r.code !== 0) throw new Error(`local: збирач не запущено: ${r.stderr.trim().split('\n').pop()}`);
    },
    async stopCollector() {
      await compose(['--profile', 'collector', 'rm', '-sf', 'collector']);
    },
    async prepareOut() {
      for (const d of ['out', 'k6', 'collector']) fs.mkdirSync(p(d), { recursive: true });
      for (const f of fs.readdirSync(p('out'))) if (/\.jsonl?$/.test(f)) fs.rmSync(p(`out/${f}`), { force: true });
    },
  };
}
