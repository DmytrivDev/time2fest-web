// @ts-check
// Підставний «світ» для тестів розгортання й відкату (W20, W21): git, Docker, Compose, wrangler і вузол — лише фейки.
// Локальна ціль пише файли вузла в тимчасовий каталог стану (справжня ФС); віддалена — у `remoteFiles`.
// Кожен виклик записує `createFakeExec`; потоки (`git archive`, `docker save`) — як `transport: 'start'`.
import { FAKE_TARGET } from './fakeTarget.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { parseJournal } from '../../lib/journal.mjs';
import { parseCurrentSha } from '../../lib/node.mjs';
import { createFakeExec } from './fakeExec.mjs';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
export const SHA_C = 'c'.repeat(40);
export const V_OLD = '11111111-1111-4111-8111-111111111111';
export const V_NEW = '22222222-2222-4222-8222-222222222222';
export const NOW = new Date('2026-11-17T10:00:00.000Z');
export const HOST = '203.0.113.10';
/** Сторожові значення (NFR-4): жодне не має з’явитися у виводі чи журналі. */
export const SENTINEL_EDGE = 'sentinel-edge-secret-0123456789abcdef0123'; // check-secrets: allow fake sentinel (NFR-4 test)
export const SENTINEL_TOKEN = 'sentinel-cf-token-fedcba9876543210fedcba'; // check-secrets: allow fake sentinel (NFR-4 test)
export const PINNED_POSTGRES = `postgres:17.12-alpine@sha256:${'0'.repeat(64)}`;
export const COMPOSE_TEXT = [
  'services:',
  '  postgres:',
  `    image: ${PINNED_POSTGRES}`,
  '  server:',
  '    image: t2f-server:${T2F_SERVER_SHA:?set by ops}',
  '',
].join('\n');

/** @param {string} kb */
const dfOut = (kb) => `Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 61202244 1000 ${kb} 5% /\n`;

/**
 * @param {{
 *   target?: string,
 *   commit?: string,
 *   running?: string | null,
 *   images?: string[],
 *   nodeImages?: string[],
 * }} [o] `running` — образ, що зараз працює (і записаний у `current.env`)
 */
export function scenario(o = {}) {
  const target = o.target ?? 'local';
  const local = target === 'local';
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-p7-'));
  /** @type {Map<string, string>} */
  const remoteFiles = new Map();
  const localImages = new Set(o.images ?? []);
  const st = {
    commit: o.commit ?? SHA_B,
    dirty: false,
    localImages,
    nodeImages: local ? localImages : new Set(o.nodeImages ?? []),
    /** @type {string | null} */ running: o.running ?? null,
    freeKb: String(50 * 1024 * 1024),
    migrateCode: 0,
    /** Чи контейнер цього образу відповідає 200. @type {(sha: string | null) => boolean} */
    healthy: (sha) => sha !== null,
    wrangler: { status: 0, deploy: 0, rollback: 0 },
    /** Код `scripts/check-bundle.mjs` (S07-03). */ bundleScan: 0,
    /** @type {string | null} */ version: V_OLD,
    /** @type {string | null} */ saved: null,
  };

  const nodeDir = local ? path.join(stateRoot, 'node-local-rehearsal') : '/srv/t2f/rehearsal';
  /** @param {string} name */
  const nodeFile = (name) => (local ? path.join(nodeDir, name) : `${nodeDir}/${name}`);
  /** @param {string} p */
  const readAt = (p) => (local ? (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '') : (remoteFiles.get(p) ?? ''));
  /** @param {string} p @param {string} content */
  const writeAt = (p, content) => {
    if (local) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    } else remoteFiles.set(p, content);
  };
  if (st.running) writeAt(nodeFile('current.env'), `T2F_ENV=rehearsal\nT2F_SERVER_SHA=${st.running}\n`);

  /** @param {{ transport: string }} c */
  const imagesOf = (c) => (c.transport === 'local' ? st.localImages : st.nodeImages);
  /** @param {string[]} argv */
  const composeTail = (argv) => argv.slice(8).join(' ');
  /** @param {string[]} argv */
  const envFileSha = (argv) => parseCurrentSha(readAt(argv[argv.indexOf('--env-file') + 1]));
  /** @param {string[]} argv */
  const isWrangler = (argv) => /wrangler\.js$/.test(argv[1] ?? '');

  const fx = createFakeExec([
    { match: ['git', 'status'], result: () => ({ stdout: st.dirty ? ' M server/src/x.ts\0' : '' }) },
    { match: ['git', 'rev-parse'], result: () => ({ stdout: `${st.commit}\n` }) },
    { match: ['git', 'show'], result: () => ({ stdout: COMPOSE_TEXT }) },
    {
      match: (c) => isWrangler(c.argv),
      result: (c) => {
        const sub = c.argv.slice(2).join(' ');
        if (sub.startsWith('deployments status')) {
          if (st.wrangler.status !== 0) return { code: st.wrangler.status, stderr: 'auth failed' };
          return { stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: st.version }] }) };
        }
        if (sub.startsWith('deploy')) {
          if (st.wrangler.deploy !== 0) return { code: st.wrangler.deploy, stderr: `deploy failed ${SENTINEL_TOKEN}` };
          st.version = V_NEW;
          return { stdout: `Deployed with token ${SENTINEL_TOKEN}` };
        }
        if (sub.startsWith('rollback')) {
          if (st.wrangler.rollback !== 0) return { code: st.wrangler.rollback };
          st.version = c.argv[3];
          return {};
        }
        return {};
      },
    },
    { match: (c) => /check-bundle\.mjs$/.test(c.argv[1] ?? ''), result: () => ({ code: st.bundleScan, stderr: st.bundleScan ? 'check-bundle: forbidden signature' : '' }) },
    { match: (c) => /next$/.test(c.argv[1] ?? '') && c.argv[2] === 'build', result: { stdout: `built with ${SENTINEL_EDGE}` } },
    {
      match: ['docker', 'image', 'inspect'],
      result: (c) => ({ code: imagesOf(c).has(c.argv[3].split(':')[1]) ? 0 : 1 }),
    },
    {
      match: ['docker', 'build'],
      result: (c) => {
        st.localImages.add(c.argv[c.argv.indexOf('-t') + 1].split(':')[1]);
        return {};
      },
    },
    {
      match: ['docker', 'image', 'ls'],
      result: (c) => ({ stdout: [...imagesOf(c)].map((s) => `${s}\n`).join('') }),
    },
    {
      match: ['docker', 'image', 'rm'],
      result: (c) => {
        imagesOf(c).delete(c.argv[3].split(':')[1]);
        return {};
      },
    },
    { match: ['docker', 'run', '--rm', '--entrypoint', 'df'], result: () => ({ stdout: dfOut(st.freeKb) }) },
    { match: ['df', '-Pk'], result: () => ({ stdout: dfOut(st.freeKb) }) },
    {
      match: ['docker', 'load'],
      result: () => {
        if (st.saved) st.nodeImages.add(st.saved);
        return { stdout: 'Loaded image' };
      },
    },
    {
      match: (c) => c.argv[0] === 'docker' && c.argv[1] === 'compose',
      result: (c) => {
        const tail = composeTail(c.argv);
        if (tail === 'run --rm --no-deps server pnpm migrate') {
          return st.migrateCode === 0 ? {} : { code: st.migrateCode, stderr: `migration failed near ${SENTINEL_EDGE}` };
        }
        if (tail === 'up -d --no-deps --force-recreate server') {
          st.running = envFileSha(c.argv);
          return {};
        }
        if (tail === 'exec -T server node scripts/health-probe.mjs') {
          return st.healthy(st.running) ? { stdout: `200 ${st.running}\n` } : { code: 1, stdout: '503 -\n' };
        }
        return {};
      },
    },
    { match: ['sh', '-c', 'test ! -e "$1" || cat -- "$1"'], result: (c) => ({ stdout: readAt(c.argv[4]) }) },
    { match: ['grep', '-q'], result: { code: 1 } },
  ]);

  /** Потоки: `git archive` і `docker save` — кілька байт, код 0. @param {string} file @param {string[]} args */
  const start = (file, args) => {
    fx.calls.push({ transport: 'start', argv: [file, ...args], inputLength: 0 });
    if (file === 'docker' && args[0] === 'save') st.saved = args[1].split(':')[1];
    const stdout = new PassThrough();
    stdout.end(Buffer.from('fake-tar-bytes'));
    return { stdout, stdin: null, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }), kill: () => {} };
  };
  const exec = { ...fx, start };

  /** @type {import('../../lib/exec.mjs').Transport | undefined} */
  let transport;
  if (!local) {
    const base = fx.sshTransport({ host: HOST, user: 'deploy', knownHostsFile: path.join(stateRoot, 'known_hosts') });
    transport = {
      kind: 'ssh',
      describe: base.describe,
      async exec(argv, opts = {}) {
        const r = await base.exec(argv, opts);
        const input = typeof opts.input === 'string' ? opts.input : '';
        if (argv[0] === 'sh' && argv[2] === 'cat > "$1.tmp" && mv "$1.tmp" "$1"') remoteFiles.set(argv[4], input);
        if (argv[0] === 'sh' && argv[2] === 'cat >> "$1"') remoteFiles.set(argv[4], (remoteFiles.get(argv[4]) ?? '') + input);
        return r;
      },
      // Власник замка на вузлі: `locked`, далі живе, доки не закриють вхід.
      start(argv) {
        fx.calls.push({ transport: base.describe, argv: [...argv], inputLength: 0 });
        const stdout = new PassThrough();
        const stdin = new PassThrough();
        /** @type {(r: import('../../lib/exec.mjs').RunResult) => void} */
        let finish = () => {};
        const done = new Promise((resolve) => {
          finish = resolve;
        });
        stdout.write('locked\n');
        stdin.on('finish', () => {
          stdout.end();
          finish({ code: 0, stdout: '', stderr: '' });
        });
        stdin.resume();
        return { stdout, stdin, done: /** @type {Promise<import('../../lib/exec.mjs').RunResult>} */ (done), kill: () => finish({ code: 143, stdout: '', stderr: '' }) };
      },
    };
  }

  const clock = {
    t: 0,
    now() {
      return this.t;
    },
    /** @param {number} ms */
    sleep(ms) {
      this.t += ms;
      return Promise.resolve();
    },
  };

  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const journalFile = local ? path.join(nodeDir, 'journal.jsonl') : `${nodeDir}/journal.jsonl`;

  return {
    st,
    fx,
    exec,
    clock,
    out,
    err,
    stateRoot,
    nodeFile,
    readAt,
    writeAt,
    remoteFiles,
    /** Підставний транспорт вузла (лише для віддаленої цілі). */
    transport,
    /** Записи журналу вузла. */
    journal: () => parseJournal(readAt(journalFile)),
    /** Сирий текст журналу. */
    journalText: () => readAt(journalFile),
    /** Дописати записи в журнал (підготовка). @param {object[]} records */
    seedJournal: (records) => writeAt(journalFile, records.map((r) => `${JSON.stringify(r)}\n`).join('')),
    /** Виклики wrangler. */
    wranglerCalls: () => fx.calls.filter((c) => isWrangler(c.argv)),
    /** Виклики docker (локальні й на вузлі). */
    dockerCalls: () => fx.calls.filter((c) => c.argv[0] === 'docker'),
    /** @param {object} [extra] */
    deps: (extra = {}) => ({
      out: (/** @type {string} */ l) => out.push(l),
      err: (/** @type {string} */ l) => err.push(l),
      env: { CLOUDFLARE_API_TOKEN: SENTINEL_TOKEN, CLOUDFLARE_ACCOUNT_ID: 'account-id', T2F_EDGE_SECRET: SENTINEL_EDGE },
      exec,
      now: () => NOW,
      clock,
      paths: { stateRoot },
      ...FAKE_TARGET,
      ...(transport ? { transport: () => /** @type {import('../../lib/exec.mjs').Transport} */ (transport) } : {}),
      ...extra,
    }),
    cleanup: () => fs.rmSync(stateRoot, { recursive: true, force: true }),
  };
}

/**
 * Успішний запис розгортання для журналу.
 * @param {Partial<import('../../lib/journal.mjs').OutcomeRecord>} [o]
 */
export function okRecord(o = {}) {
  return {
    kind: 'deploy',
    at: '2026-11-16T10:00:00.000Z',
    env: 'rehearsal',
    commit: SHA_B,
    imageBefore: `t2f-server:${SHA_A}`,
    imageAfter: `t2f-server:${SHA_B}`,
    workerVersionBefore: V_OLD,
    workerVersionAfter: V_NEW,
    edgeSecretGeneration: 1,
    result: 'ok',
    failedStep: null,
    ...o,
  };
}
