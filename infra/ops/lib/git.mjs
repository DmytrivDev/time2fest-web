// @ts-check
// Git перед збіркою: чисте робоче дерево (AC-11), `--commit` — справжній коміт (AC-10), архів дерева коміту
// для збірки образу (AC-1). Лише argv, без оболонки; значення SHA перевірено до запуску.
import { REPO_ROOT, SHA40, realExec, start as realStart } from './exec.mjs';

const RE_COMMIT = /^[0-9a-f]{7,40}$/;

/**
 * @typedef {import('./exec.mjs').Executor} Executor
 * @typedef {import('./exec.mjs').Handle} Handle
 * @typedef {{ code: 0 } | { code: 2, message: string }} CleanResult
 * @typedef {{ code: 0, sha: string } | { code: 2, message: string }} CommitResult
 */

/**
 * @param {{ exec?: Pick<Executor, 'run'>, start?: typeof realStart, cwd?: string }} [deps]
 *   `exec.run` — для `status`/`rev-parse` (підставний у тестах); `start` — для потоку `archive`.
 */
export function createGit(deps = {}) {
  const exec = deps.exec ?? realExec;
  const start = deps.start ?? realStart;
  const cwd = deps.cwd ?? REPO_ROOT;
  // Без пейджера й без питань; локальні налаштування користувача не змінюють вивід porcelain.
  const env = { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };

  return {
    /**
     * Будь-який запис `git status --porcelain=v1 -z` (змінений, доданий, невідстежений файл) → відмова.
     * @returns {Promise<CleanResult>}
     */
    async assertClean() {
      const r = await exec.run('git', ['status', '--porcelain=v1', '-z'], { cwd, env });
      if (r.code !== 0) return { code: 2, message: `git status завершився з кодом ${r.code}` };
      if (r.stdout.split('\0').some((e) => e.trim() !== '')) {
        return { code: 2, message: 'робоче дерево має незакомічені зміни' };
      }
      return { code: 0 };
    },

    /**
     * `sha` (7–40 hex) або `HEAD` → повний SHA коміту. Не коміт → код 2.
     * @param {string} [sha]
     * @returns {Promise<CommitResult>}
     */
    async resolveCommit(sha) {
      if (sha !== undefined && !RE_COMMIT.test(sha)) return { code: 2, message: '--commit: має бути 7–40 шістнадцяткових символів' };
      const ref = `${sha ?? 'HEAD'}^{commit}`;
      const r = await exec.run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, env });
      const full = r.stdout.trim();
      if (r.code !== 0 || !SHA40.test(full)) {
        return { code: 2, message: sha === undefined ? 'HEAD не вказує на коміт' : `--commit: ${sha} не є комітом репозиторію` };
      }
      return { code: 0, sha: full };
    },

    /**
     * Потік tar дерева коміту (`git archive --format=tar <sha>`). `done` — код git: споживач перевіряє його,
     * щоб обрізаний архів не вважався успішною збіркою.
     * @param {string} sha повний SHA з `resolveCommit`
     * @returns {Handle}
     */
    archive(sha) {
      if (!SHA40.test(sha)) throw new TypeError('archive: потрібен повний SHA коміту (40 hex)');
      return start('git', ['archive', '--format=tar', sha], { cwd, env });
    },
  };
}

/** @typedef {ReturnType<typeof createGit>} Git */
