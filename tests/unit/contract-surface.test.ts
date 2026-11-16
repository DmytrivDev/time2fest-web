/** Скрипт additive-only перевірки шва (SPEC-01, AC-38..AC-41): чорна скринька на мінімальному дереві в tmp. Середовище jsdom (спільний setup), але вся робота — у дочірньому процесі Node. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(process.cwd(), 'scripts', 'contract-surface.mjs');
const dirs: string[] = [];

const BASE = {
  'packages/contracts/src/index.ts': `export type Reason = 'a' | 'b';\nexport interface Thing { id: string; note?: string; reason: Reason }\n`,
  'lib/api/contracts/x.ts': `import type { Shared } from '@/lib/data/types';\nexport interface XService { get(id: string): Shared }\nexport type XEvent = { type: 'one'; n: number } | { type: 'two'; s: string };\n`,
  'lib/data/types.ts': `export interface Shared { v: number }\nexport interface Unused { u: number }\n`,
};

function makeTree(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-'));
  dirs.push(dir);
  write(dir, files);
  return dir;
}

function write(dir: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
}

function run(dir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [script, '--root', dir, '--baseline', path.join(dir, 'baseline.json'), ...args], {
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('contract-surface', { timeout: 60_000 }, () => {
  it('fails and names a removed field, a removed union member and a lost "?" (AC-38)', () => {
    const dir = makeTree(BASE);
    expect(run(dir, '--update').code).toBe(0);
    expect(run(dir, '--check').code).toBe(0);

    write(dir, { 'packages/contracts/src/index.ts': `export type Reason = 'a';\nexport interface Thing { id: string; note: string; reason: Reason }\n` });
    const r1 = run(dir, '--check');
    expect(r1.code).not.toBe(0);
    expect(r1.out).toContain('Reason: union member \'b\' removed');
    expect(r1.out).toContain('Thing.note: optional became required');

    write(dir, { 'packages/contracts/src/index.ts': `export type Reason = 'a' | 'b';\nexport interface Thing { id: string; note?: string }\n` });
    const r2 = run(dir, '--check');
    expect(r2.code).not.toBe(0);
    expect(r2.out).toContain('Thing.reason: property removed');
  });

  it('accepts a new optional field and a new reason after --update (AC-39)', () => {
    const dir = makeTree(BASE);
    run(dir, '--update');
    write(dir, { 'packages/contracts/src/index.ts': `export type Reason = 'a' | 'b' | 'c';\nexport interface Thing { id: string; note?: string; extra?: number; reason: Reason }\n` });
    expect(run(dir, '--update').code).toBe(0);
    expect(run(dir, '--check').code).toBe(0);
  });

  it('fails an unrecorded addition and prints the refresh command (AC-40)', () => {
    const dir = makeTree(BASE);
    run(dir, '--update');
    write(dir, { 'packages/contracts/src/index.ts': `export type Reason = 'a' | 'b' | 'c';\nexport interface Thing { id: string; note?: string; reason: Reason }\n` });
    const r = run(dir, '--check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('--update');
  });

  it('records a breaking change only with --update --breaking (AC-41)', () => {
    const dir = makeTree(BASE);
    run(dir, '--update');
    write(dir, { 'packages/contracts/src/index.ts': `export type Reason = 'a' | 'b';\nexport interface Thing { id: string; reason: Reason }\n` });
    expect(run(dir, '--update').code).toBe(1);
    expect(run(dir, '--update', '--breaking').code).toBe(0);
    expect(run(dir, '--check').code).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'));
    expect(baseline.breaking[0].changes.join('\n')).toContain('Thing');
  });

  it('covers only reachable declarations of lib/data/types.ts', () => {
    const dir = makeTree(BASE);
    run(dir, '--update');
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'));
    expect(baseline.surfaces['lib/data/types.ts#Shared']).toBeDefined();
    expect(baseline.surfaces['lib/data/types.ts#Unused']).toBeUndefined();
  });
});
