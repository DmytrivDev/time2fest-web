/** Скрипт перевірки бандла (SPEC-06, AC-56): коди виходу на фікстурних теках і справжність підпису в установленому centrifuge. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'scripts/check-bundle.mjs');
const SIGNATURE = 'token expired but no getToken function set in the configuration';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-bundle-'));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(dir: string, ...flags: string[]) {
  return spawnSync(process.execPath, [script, dir, ...flags], { encoding: 'utf8' });
}

function fixture(name: string, content: string): string {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'x.js'), content);
  return d;
}

describe('check-bundle', () => {
  it('чиста тека → 0', () => {
    const d = path.join(tmp, 'clean');
    fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(d, 'sub', 'a.js'), 'console.log(1)');
    const r = run(d);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('check-bundle: clean (1 files)');
  });

  it('файл із підписом → 1 і назва файлу', () => {
    const d = path.join(tmp, 'dirty');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'bad.js'), `x("${SIGNATURE}")`);
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bad.js');
  });

  it.each([
    ['door', 'fetch("/api/_test/clock")'],
    ['machine', 'sessionStorage.getItem("t2f:session:timeMachine")'],
  ])('підпис тестової збірки (%s) → 1, незалежно від кінців рядків', (name, code) => {
    const r = run(fixture(`t-${name}`, `${code}\r\n`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('x.js');
  });

  it('--allow-realtime: centrifuge дозволено, дверцята — ні', () => {
    expect(run(fixture('rt-ok', `x("${SIGNATURE}")`), '--allow-realtime').status).toBe(0);
    expect(run(fixture('rt-bad', `x("${SIGNATURE}");fetch("/api/_test/clock")`), '--allow-realtime').status).toBe(1);
  });

  it('немає теки → 2', () => {
    const r = run(path.join(tmp, 'missing'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('directory not found');
  });

  it('підпис справжній для встановленого centrifuge', () => {
    const file = path.join(root, 'node_modules/centrifuge/dist/centrifuge.js');
    expect(fs.readFileSync(file, 'utf8')).toContain(SIGNATURE);
  });
});
