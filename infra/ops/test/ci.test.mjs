// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';

const root = new URL('../../../', import.meta.url);
const OPS_FILES =
  'node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}';
const OPS_FULL =
  'node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2';

describe('ops verify row and CI step', () => {
  const config = JSON.parse(readFileSync(new URL('.claude/sdd-engineering.json', root), 'utf8'));

  it('has exactly one ops row with the planned commands', () => {
    const rows = config.verify.filter((/** @type {{ package: string }} */ r) => r.package === 'ops');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ package: 'ops', dir: 'infra/ops', files: OPS_FILES, full: OPS_FULL });
  });

  it('keeps every other package row', () => {
    const names = config.verify.map((/** @type {{ package: string }} */ r) => r.package);
    for (const n of ['web', 'contracts', 'rules', 'server', 'edge', 'infra']) expect(names).toContain(n);
  });

  it('verify.yml has an `ops full` step running the full command in infra/ops', () => {
    const lines = readFileSync(new URL('.github/workflows/verify.yml', root), 'utf8').split('\n');
    const i = lines.findIndex((l) => l.trim() === '- name: ops full');
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1].trim()).toBe('working-directory: infra/ops');
    expect(lines[i + 2].trim()).toBe(`run: ${OPS_FULL}`);
  });
});

describe('ops.mjs entry', () => {
  it('returns 1 with `not implemented` for a known subcommand', async () => {
    /** @type {string[]} */
    const lines = [];
    expect(await main(['deploy', '--env', 'rehearsal'], { out: (l) => lines.push(l) })).toBe(1);
    expect(lines.join('\n')).toContain('not implemented');
  });

  it('returns 2 for an unknown subcommand', async () => {
    expect(await main(['nope'], { out: () => {} })).toBe(2);
  });
});
