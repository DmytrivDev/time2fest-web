// @ts-check
// SPEC-13b W46 — відновлення копії в чистий локальний стек справжнім Docker (HEAVY, під винятковим замком машини).
// AC-53, AC-55, AC-56 (--no-record), AC-57, AC-59. Джерело — тестове середовище `test-local` (лише за
// `T2F_OPS_TEST=1`): s3mock стека worktree, копія бази worktree, зроблена образом HEAD (`ops backup-now`).
// Ціль — власні проєкти Compose `t2f-restore-<штамп>` кожного запуску; `-p t2f` не чіпається. Жодного SSH,
// жодного R2 чи Telegram.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESTORE_ENV, createRestoreSuite, docker, sleep } from './support.mjs';

const s = createRestoreSuite();
const RESTORE = ['restore', '--env', RESTORE_ENV, '--from', 'latest', '--target', 'local', '--no-record'];
/** Повідомлення `ops restore` про відмову перевірки копії (код 3 `restore-pull`). */
const VERIFY_FAILED = 'перевірка копії не пройшла';
/** Тимчасова таблиця бази worktree для тесту SIGINT. */
const FILLER = 'w46_sigint_filler';

/** @type {{ key: string, manifest: Record<string, any>, seconds: number }} */
let copy;
/** @type {Record<string, string | number>} */
const numbers = {};

/** Після кожного запуску: теки тимчасових файлів і проєкти `t2f-restore-*` прибрано. */
async function expectNoLeftovers() {
  const left = await s.leftovers();
  expect(left.dirs).toEqual([]);
  expect(left.projects).toEqual([]);
}

/**
 * Разова проба в контейнері `pull` (свіжий `docker exec` щоразу): якщо в `/proc` є `pg_restore` (у Debian це
 * `pg_wrapper` → `/usr/lib/postgresql/17/bin/pg_restore`, тож шукається будь-де в рядку), надсилає SIGINT
 * процесам `node … src/cli/ops.ts` (команда `restore-pull`) і друкує їх; інакше — `none`.
 */
const PROBE_SH = [
  'me=$$; seen=""',
  'for d in /proc/[0-9]*; do c=$(tr "\\000" " " < $d/cmdline 2>/dev/null); case "$c" in "sh -c"*) ;; *pg_restore\\ *) seen=${d#/proc/};; esac; done',
  'if [ -z "$seen" ]; then echo none; exit 0; fi',
  'sig=""',
  'for d in /proc/[0-9]*; do p=${d#/proc/}; [ "$p" = "$me" ] && continue; c=$(tr "\\000" " " < $d/cmdline 2>/dev/null); case "$c" in "node "*src/cli/ops.ts*) kill -INT $p 2>/dev/null && sig="$sig $p";; esac; done',
  'echo "pg_restore-seen pid=$seen signalled=$sig"',
].join('; ');

/** Контейнер `pull` проєкту `t2f-restore-*` (разовий `compose run`), щойно він з’явиться. */
async function waitPullContainer(timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await docker(['ps', '--filter', 'label=com.docker.compose.service=pull', '--format', '{{.ID}} {{.Label "com.docker.compose.project"}}']);
    const hit = r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim().split(' '))
      .find(([, project]) => project?.startsWith('t2f-restore-'));
    if (hit) return hit[0];
    await sleep(200);
  }
  throw new Error('контейнер pull не з’явився');
}

beforeAll(async () => {
  await s.setup();
  // Дві копії: `latest` — друга; вікно втрати — проміжок між ними (AC-57).
  await s.backup();
  copy = await s.backup();
  numbers.backupSeconds = copy.seconds;
  numbers.dumpBytes = copy.manifest.size;
});

afterAll(async () => {
  console.log(`[w46] numbers ${JSON.stringify(numbers)}`);
  await s.cleanup();
});

describe('ops restore --target local (W46)', () => {
  it('test-local без T2F_OPS_TEST — невідоме середовище, до будь-якого виклику', async () => {
    const saved = process.env.T2F_OPS_TEST;
    delete process.env.T2F_OPS_TEST;
    try {
      const r = await s.ops(RESTORE);
      expect(r.code).toBe(2);
      expect(r.text).toContain('--env');
    } finally {
      if (saved === undefined) delete process.env.T2F_OPS_TEST;
      else process.env.T2F_OPS_TEST = saved;
    }
  });

  describe('з T2F_OPS_TEST=1', () => {
    beforeAll(() => {
      process.env.T2F_OPS_TEST = '1';
    });
    afterAll(() => {
      delete process.env.T2F_OPS_TEST;
    });

    it('копія бази worktree → чистий стек: міграції, здоров’я, рядки = маніфест, каталог, звіт (AC-53, AC-57)', async () => {
      const r = await s.ops(RESTORE);
      expect(r.code, r.text).toBe(0);
      expect(r.text).toContain(`копія ${copy.manifest.key}: ${copy.manifest.size} байт`);
      const done = r.text.match(/готово за (\d+) с; вікно втрати ([^;]+);/);
      expect(done).not.toBeNull();
      expect(r.text).toContain('міграції: 0 непройдених; рядки = маніфест; каталог ');
      numbers.restoreSeconds = Number(done?.[1]);
      numbers.restoreWallSeconds = r.seconds;
      numbers.lossWindow = String(done?.[2]);
      numbers.rowCounts = JSON.stringify(copy.manifest.rowCounts);
      await expectNoLeftovers();
    });

    it('зіпсований байт копії → відмова до pg_restore, тимчасова тека прибрана (AC-55, AC-59)', async () => {
      const orig = await s.getObject(copy.manifest.key);
      const bad = Buffer.from(orig);
      const at = Math.floor(bad.length / 2);
      bad[at] = bad[at] ^ 0xff;
      await s.putObject(copy.manifest.key, bad);
      try {
        const r = await s.ops(RESTORE);
        expect(r.code).toBe(1);
        expect(r.text).toContain(VERIFY_FAILED);
        expect(r.text).not.toContain('готово за');
      } finally {
        await s.putObject(copy.manifest.key, orig);
      }
      await expectNoLeftovers();
    });

    it('інший ключ копії → відмова до завантаження й pg_restore (AC-55)', async () => {
      s.writeSourceEnv({ T2F_BACKUP_KEY: crypto.randomBytes(32).toString('base64') });
      try {
        const r = await s.ops(RESTORE);
        expect(r.code).toBe(1);
        expect(r.text).toContain(VERIFY_FAILED);
      } finally {
        s.writeSourceEnv();
      }
      await expectNoLeftovers();
    });

    it('кількість рядків не збігається з маніфестом → відмова (AC-57)', async () => {
      const manifestKey = copy.manifest.key.replace(/\.dump\.enc$/, '.manifest.json');
      const orig = await s.getObject(manifestKey);
      const m = JSON.parse(orig.toString('utf8'));
      m.rowCounts.countries = Number(m.rowCounts.countries) + 1;
      await s.putObject(manifestKey, Buffer.from(JSON.stringify(m), 'utf8'));
      try {
        const r = await s.ops(RESTORE);
        expect(r.code).toBe(1);
        expect(r.text).toContain('кількість рядків не збігається з маніфестом: countries');
      } finally {
        await s.putObject(manifestKey, orig);
      }
      await expectNoLeftovers();
    });

    it('SIGINT під час pg_restore → команда прибирає свою теку, ops — решту (AC-59)', async () => {
      // Копія бази worktree ~0,3 МБ відновлюється за долі секунди — спостерігач не встигає. Тимчасова таблиця
      // (лише на час цієї копії; прибирається у finally) робить pg_restore довгим, щоб SIGINT упав саме на нього.
      await s.sql(`CREATE TABLE ${FILLER} AS SELECT g AS id, md5(g::text) || md5((g * 7)::text) AS v FROM generate_series(1, 1500000) AS g`);
      try {
        const big = await s.backup();
        numbers.sigintDumpBytes = big.manifest.size;
      } finally {
        await s.sql(`DROP TABLE IF EXISTS ${FILLER}`);
      }
      const running = s.ops(RESTORE);
      const id = await Promise.race([waitPullContainer(), running.then((x) => `ended ${x.code}`)]);
      expect(id.startsWith('ended'), 'restore завершився раніше, ніж з’явився контейнер pull').toBe(false);
      // Тека тимчасових файлів цілі на хості (змонтована в `pull` як /restore-tmp).
      const project = (await docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', id])).stdout.trim();
      const hostTmp = path.join(s.stateRoot, 'restore', project, 'tmp');
      let probe = 'none';
      let finished = false;
      void running.then(() => {
        finished = true;
      });
      while (!finished && probe.startsWith('none')) {
        probe = (await docker(['exec', id, 'sh', '-c', PROBE_SH])).stdout.trim() || 'none';
      }
      console.log(`[w46] probe: ${probe}`);
      expect(probe).toMatch(/^pg_restore-seen pid=\d+ signalled=( \d+)+$/);
      // Прибирання самої команди: тека `restore-*` зникає, поки тека цілі ще є (ops прибирає її лише після виходу).
      let innerGone = false;
      const t0 = Date.now();
      while (!finished && Date.now() - t0 < 30_000) {
        const inner = fs.existsSync(hostTmp) ? fs.readdirSync(hostTmp).filter((n) => n.startsWith('restore-')) : null;
        if (inner !== null && inner.length === 0) {
          innerGone = true;
          break;
        }
        await sleep(20);
      }
      const r = await running;
      numbers.sigintInnerCleanupMs = innerGone ? Date.now() - t0 : -1;
      expect(innerGone, 'restore-pull не прибрав свою теку після SIGINT').toBe(true);
      expect(r.code).toBe(1);
      expect(r.text).toContain('restore-pull завершився з кодом');
      await expectNoLeftovers();
    });
  });
});
