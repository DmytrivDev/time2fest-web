/**
 * SPEC-14 W27, NFR-8 — presence and passport decisions use the server clock only: no wall-clock read
 * (`Date.now(`, `new Date()` without an argument, `performance.now(`) in `server/src/{domain/presence,domain/passport,presence}/**`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const DIRS = ['domain/presence', 'domain/passport', 'presence'];
const WALL_CLOCK = [/\bDate\.now\s*\(/, /\bnew Date\s*\(\s*\)/, /\bperformance\.now\s*\(/];

function filesOf(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesOf(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('no wall clock in presence code (NFR-8)', () => {
  const files = DIRS.flatMap((d) => filesOf(path.join(src, d)));

  it('finds the presence sources', () => {
    expect(files.some((f) => f.endsWith(`claimDecision.ts`))).toBe(true);
    expect(files.some((f) => f.endsWith(`stamps.ts`))).toBe(true);
    expect(files.some((f) => f.endsWith(`stampView.ts`))).toBe(true);
  });

  it('no file reads the wall clock', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        if (WALL_CLOCK.some((re) => re.test(line))) hits.push(`${path.relative(src, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
