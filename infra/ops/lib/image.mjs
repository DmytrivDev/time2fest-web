// @ts-check
// Образ сервера (AC-1, AC-16): збірка з архіву коміту (без `.git`), доставка на вузол (`docker save | gzip` →
// `docker load`), прибирання старих образів. Збірка завжди на машині оператора (локальний транспорт);
// доставка й прибирання — через транспорт вузла. Лише argv, без оболонки.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { SHA40, start as realStart } from './exec.mjs';

export const IMAGE_REPO = 't2f-server';
/** Dockerfile відносно кореня архіву коміту (W9). */
export const DOCKERFILE = 'server/Dockerfile';
/** Скільки останніх розгорнутих образів лишати, крім поточного й попереднього (AC-16). */
export const KEEP_RECENT = 3;

const BUILD_TIMEOUT_MS = 45 * 60_000;
const LOAD_TIMEOUT_MS = 30 * 60_000;
const SHORT_TIMEOUT_MS = 60_000;
const LIST_FORMAT = '{{.Tag}}';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./exec.mjs').RunResult} RunResult
 * @typedef {{ code: 0, skipped: boolean } | { code: 1, message: string, detail?: string }} StepResult
 */

/** @param {string} sha */
export function imageTag(sha) {
  if (!SHA40.test(sha)) throw new TypeError('образ: потрібен повний SHA коміту (40 hex)');
  return `${IMAGE_REPO}:${sha}`;
}

/**
 * SHA з посилання на образ `t2f-server:<sha>` (поле журналу `imageBefore`/`imageAfter`); інше — `null`.
 * @param {string | null | undefined} ref
 */
export function shaOfImage(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(`${IMAGE_REPO}:`)) return null;
  const sha = ref.slice(IMAGE_REPO.length + 1);
  return SHA40.test(sha) ? sha : null;
}

/**
 * Які образи лишити: поточний ∪ попередній ∪ `KEEP_RECENT` найновіших розгорнутих (найновіші першими).
 * @param {{ current?: string | null, previous?: string | null, deployed?: string[] }} o
 * @returns {string[]}
 */
export function keepShas({ current, previous, deployed = [] }) {
  /** @type {string[]} */
  const keep = [];
  for (const s of [current, previous, ...deployed.slice(0, KEEP_RECENT)]) {
    if (typeof s === 'string' && SHA40.test(s) && !keep.includes(s)) keep.push(s);
  }
  return keep;
}

/**
 * Останні рядки stderr/stdout для повідомлення про помилку (маскує вивід ops).
 * @param {RunResult} r
 * @param {number} [n]
 */
export function tailOf(r, n = 20) {
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n).join('\n');
}

/** Чи stderr збірки означає, що BuildKit не знайшов `-f` у контексті зі stdin (тоді — запасний шлях). @param {string} stderr */
function dockerfileNotInStdinContext(stderr) {
  return /dockerfile/i.test(stderr) && /(no such file|not found|cannot locate|unable to prepare)/i.test(stderr);
}

/**
 * @param {{
 *   local: Transport,
 *   git: Pick<import('./git.mjs').Git, 'archive'>,
 *   start?: typeof realStart,
 *   tmpdir?: () => string,
 * }} deps `local` — машина оператора (там `docker build`/`docker save`); `start` — потік `docker save`.
 */
export function createImage(deps) {
  const { local, git } = deps;
  const start = deps.start ?? realStart;
  const tmpdir = deps.tmpdir ?? (() => os.tmpdir());

  /** @param {Transport} t @param {string} tag */
  const present = async (t, tag) => (await t.exec(['docker', 'image', 'inspect', tag], { timeoutMs: SHORT_TIMEOUT_MS })).code === 0;

  /**
   * `git archive <sha>` → `tar -xf -` у тимчасову теку → `docker build <тека>`. Запасний шлях, коли BuildKit
   * не приймає `-f` з контекстом на stdin.
   * @param {string} sha
   * @param {string} tag
   * @returns {Promise<StepResult>}
   */
  async function buildFromFolder(sha, tag) {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 't2f-ctx-'));
    try {
      const h = git.archive(sha);
      const x = await local.exec(['tar', '-xf', '-', '-C', dir], { input: h.stdout, timeoutMs: BUILD_TIMEOUT_MS });
      const a = await h.done;
      if (x.code !== 0 || a.code !== 0) return { code: 1, message: 'архів коміту не розпаковано', detail: tailOf(x) };
      const r = await local.exec(
        ['docker', 'build', '-f', path.join(dir, ...DOCKERFILE.split('/')), '--build-arg', `T2F_COMMIT=${sha}`, '-t', tag, dir],
        { timeoutMs: BUILD_TIMEOUT_MS },
      );
      return r.code === 0 ? { code: 0, skipped: false } : { code: 1, message: `docker build завершився з кодом ${r.code}`, detail: tailOf(r) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    /** Чи є образ коміту на вузлі. @param {Transport} t @param {string} sha */
    present: (t, sha) => present(t, imageTag(sha)),

    /**
     * Образ `t2f-server:<sha>` з дерева коміту. Наявний локальний тег використовується повторно (A2).
     * @param {string} sha
     * @returns {Promise<StepResult>}
     */
    async buildImage(sha) {
      const tag = imageTag(sha);
      if (await present(local, tag)) return { code: 0, skipped: true };
      const h = git.archive(sha);
      const r = await local.exec(
        ['docker', 'build', '-f', DOCKERFILE, '--build-arg', `T2F_COMMIT=${sha}`, '-t', tag, '-'],
        { input: h.stdout, timeoutMs: BUILD_TIMEOUT_MS },
      );
      const a = await h.done;
      if (a.code !== 0) {
        // Обрізаний архів не може бути успішною збіркою: тег, якщо з’явився, прибираємо.
        if (r.code === 0) await local.exec(['docker', 'image', 'rm', tag], { timeoutMs: SHORT_TIMEOUT_MS });
        return { code: 1, message: `git archive завершився з кодом ${a.code}` };
      }
      if (r.code === 0) return { code: 0, skipped: false };
      if (dockerfileNotInStdinContext(r.stderr)) return buildFromFolder(sha, tag);
      return { code: 1, message: `docker build завершився з кодом ${r.code}`, detail: tailOf(r) };
    },

    /**
     * `docker save` → gzip → `docker load` на вузлі; пропуск, коли тег там уже є (і для локальної цілі).
     * @param {Transport} t транспорт вузла
     * @param {string} sha
     * @returns {Promise<StepResult>}
     */
    async deliver(t, sha) {
      const tag = imageTag(sha);
      if (await present(t, tag)) return { code: 0, skipped: true };
      const h = start('docker', ['save', tag]);
      const gz = zlib.createGzip();
      h.stdout.on('error', () => {});
      gz.on('error', () => {});
      h.stdout.pipe(gz);
      const r = await t.exec(['docker', 'load'], { input: gz, timeoutMs: LOAD_TIMEOUT_MS });
      if (r.code !== 0) {
        h.kill();
        await h.done;
        return { code: 1, message: `docker load завершився з кодом ${r.code}`, detail: tailOf(r) };
      }
      const s = await h.done;
      if (s.code !== 0) return { code: 1, message: `docker save завершився з кодом ${s.code}` };
      return { code: 0, skipped: false };
    },

    /**
     * Видаляє на вузлі кожен образ `t2f-server:<40 hex>`, якого немає в `keep`. Інші теги не чіпає.
     * @param {Transport} t
     * @param {string[]} keep
     * @returns {Promise<{ removed: string[], failed: string[] }>}
     */
    async retain(t, keep) {
      const argv = ['docker', 'image', 'ls', IMAGE_REPO, '--format', LIST_FORMAT];
      const r = await t.exec(argv, { allow: [...argv], timeoutMs: SHORT_TIMEOUT_MS });
      if (r.code !== 0) return { removed: [], failed: ['(перелік образів)'] };
      /** @type {string[]} */
      const removed = [];
      /** @type {string[]} */
      const failed = [];
      const tags = [...new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => SHA40.test(l)))];
      for (const sha of tags) {
        if (keep.includes(sha)) continue;
        const rm = await t.exec(['docker', 'image', 'rm', imageTag(sha)], { timeoutMs: SHORT_TIMEOUT_MS });
        (rm.code === 0 ? removed : failed).push(sha);
      }
      return { removed, failed };
    },
  };
}

/** @typedef {ReturnType<typeof createImage>} Image */
