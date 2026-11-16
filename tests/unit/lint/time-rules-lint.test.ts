/** Лінт правил часу (SPEC-03, AC-2..AC-5, NFR-2): чистота пакета, старі шляхи, перевірка дублювання — і шов не загублено. Середовище jsdom (спільний setup чистить localStorage), ESLint працює через Node API. */
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import * as time from '@time2fest/rules/time';
import { BOUNDARY_VALUES, RULE_CONSTANT_NAMES } from '../../../packages/rules/eslint/no-time-rule-copy.mjs';

const root = path.resolve(__dirname, '../../..');
let eslint: ESLint;

// Перше завантаження конфігу (next, typescript-eslint) триває до хвилини — прогріваємо один раз.
beforeAll(async () => {
  eslint = new ESLint({ cwd: root });
  await eslint.lintText('', { filePath: path.join(root, 'components/__warm__.tsx') });
}, 180_000);

async function lint(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return result!.messages;
}

const ids = <T extends { ruleId: string | null }>(messages: T[], ruleId: string) => messages.filter((m) => m.ruleId === ruleId);

describe('packages/rules/src — чистота (AC-2, AC-3, NFR-2)', { timeout: 60_000 }, () => {
  const file = 'packages/rules/src/time/__sample__.ts';

  it('AC-2: Date.now, performance.now і new Date() без аргументу — три помилки', async () => {
    const code = 'export const a = () => Date.now();\nexport const b = () => performance.now();\nexport const c = () => new Date();\n';
    expect(ids(await lint(code, file), 'no-restricted-syntax')).toHaveLength(3);
  });

  it('AC-2: new Date(0) з аргументом — дозволено', async () => {
    expect(ids(await lint('export const d = () => new Date(0);\n', file), 'no-restricted-syntax')).toHaveLength(0);
  });

  it('AC-3: імпорт застосунку (@/…) — помилка', async () => {
    const code = "import type { Ms } from '@/lib/data/types';\nexport const x = (v: Ms) => v;\n";
    expect(ids(await lint(code, file), 'no-restricted-imports')).toHaveLength(1);
  });

  it('AC-3: відносний шлях за межі пакета — помилка; власний модуль — ні', async () => {
    expect(ids(await lint("import { x } from '../../../contracts/src/index';\nexport const y = x;\n", file), 'no-restricted-imports')).toHaveLength(1);
    expect(ids(await lint("import { HANDOVER_AFTER } from './constants';\nexport const y = HANDOVER_AFTER;\n", file), 'no-restricted-imports')).toHaveLength(0);
  });

  it('NFR-2: let на рівні модуля — помилка', async () => {
    expect(ids(await lint('let counter = 0;\nexport const next = () => counter + 1;\n', file), 'no-restricted-syntax')).toHaveLength(1);
  });
});

describe('старі шляхи правил (AC-4)', { timeout: 60_000 }, () => {
  it('компонент: @/lib/toast/season — no-restricted-imports, і шов у тому самому файлі теж спрацьовує', async () => {
    const code = [
      "import { toastSeason } from '@/lib/toast/season';",
      "import { simLive } from '@/lib/api/sim/live';",
      "import { useAuthStore } from '@/stores/auth';",
      'export const all = [toastSeason, simLive, useAuthStore];',
      'export const bad = (store: { setRate: () => void }) => store.setRate;',
      '',
    ].join('\n');
    const messages = await lint(code, 'components/__s__.tsx');
    const imports = ids(messages, 'no-restricted-imports');
    expect(imports).toHaveLength(3);
    expect(imports.some((m) => m.message.includes('@time2fest/rules/time'))).toBe(true);
    expect(imports.some((m) => m.message.includes('Імітація'))).toBe(true);
    expect(imports.some((m) => m.message.includes('Вхід перенесено'))).toBe(true);
    expect(ids(messages, 'no-restricted-syntax')).toHaveLength(1);
  });

  it('lib: видалений модуль через @/, ../ і ./ — помилка', async () => {
    expect(ids(await lint("import { eventStatus } from '@/lib/engine/eventStatus';\nexport const s = eventStatus;\n", 'lib/live/__s__.ts'), 'no-restricted-imports')).toHaveLength(1);
    expect(ids(await lint("import { zoneState } from '../engine/zoneState';\nexport const s = zoneState;\n", 'lib/live/__s__.ts'), 'no-restricted-imports')).toHaveLength(1);
    expect(ids(await lint("import { isCelebrating } from './celebration';\nexport const s = isCelebrating;\n", 'lib/engine/__s__.ts'), 'no-restricted-imports')).toHaveLength(1);
  });

  it('перенесені імена з модулів, що лишились, — помилка; решта імен — ні', async () => {
    const moved = "import { RATING_OPEN_AFTER } from '@/lib/rating/rating';\nimport { HANDOVER_AFTER } from './config';\nexport const s = [RATING_OPEN_AFTER, HANDOVER_AFTER];\n";
    expect(ids(await lint(moved, 'lib/engine/__s__.ts'), 'no-restricted-imports')).toHaveLength(2);
    const kept = "import { NEXT_EVENT_JUMP } from '@/lib/engine/config';\nimport { airSlots } from '@/lib/engine/currentAirEvent';\nexport const s = [NEXT_EVENT_JUMP, airSlots];\n";
    expect(ids(await lint(kept, 'lib/time/__s__.ts'), 'no-restricted-imports')).toHaveLength(0);
  });
});

describe('перевірка дублювання меж (AC-5)', { timeout: 60_000 }, () => {
  const file = 'components/__dup__.tsx';
  const copies = async (code: string) => ids(await lint(code, file), 't2f-time/no-rule-copy');

  it('константа правила до моменту — помилка', async () => {
    const code = "import { HANDOVER_AFTER } from '@time2fest/rules/time';\nexport const f = (zone: { midnightMs: number }) => zone.midnightMs + HANDOVER_AFTER;\n";
    expect(await copies(code)).toHaveLength(1);
  });

  it('значення межі літералом — помилка', async () => {
    expect(await copies('export const f = (now: number, m: number) => now >= m + 15_000;\n')).toHaveLength(1);
  });

  it('власна константа з тим самим значенням у порівнянні — помилка', async () => {
    expect(await copies('const C = 2 * 60_000;\nexport const f = (now: number, midnightMs: number) => midnightMs - now < C;\n')).toHaveLength(1);
  });

  it('дозволені вирази — без помилок', async () => {
    const code = [
      "import { HANDOVER_AFTER } from '@time2fest/rules/time';",
      "import { NEXT_EVENT_JUMP } from '@/lib/engine/config';",
      'export const a = (sinceMidnight: number) => HANDOVER_AFTER - sinceMidnight;',
      'export const b = (air: { nextEvent: { midnightMs: number } }) => air.nextEvent.midnightMs + NEXT_EVENT_JUMP;',
      'export const c = (z: { midnightMs: number }, j: number) => z.midnightMs + (j + 1) * 60_000;',
      '',
    ].join('\n');
    expect(await copies(code)).toHaveLength(0);
  });

  it('лок-степ: імена й значення збігаються з константами пакета', () => {
    const constants = Object.entries(time).filter(([name, v]) => /^[A-Z][A-Z0-9_]*$/.test(name) && typeof v === 'number' && name !== 'SERVER_CLOCK_TOLERANCE_MS');
    expect([...RULE_CONSTANT_NAMES].sort()).toEqual(constants.map(([name]) => name).sort());
    expect([...BOUNDARY_VALUES].sort((a, b) => a - b)).toEqual([...new Set(constants.map(([, v]) => v as number))].sort((a, b) => a - b));
  });
});
