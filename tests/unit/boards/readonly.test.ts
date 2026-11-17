import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../scripts/boards');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : e.name.endsWith('.mjs') ? [p] : [];
  });
}

// A mutating fs call whose line mentions the manifest root (or board-tools root) is a violation.
const MUTATE = /\b(writeFile\w*|appendFile\w*|rm\w*|rename\w*|copyFile\w*)\s*\(/;
const MANIFEST_ROOT = /manifestsDir|btDir|T2F_BT_DIR|manifests/;
// Writes that go only to the --out directory are allowed.
const ALLOWED = /args\.out|\bout\b/;

describe('board tools never write under the manifest root', () => {
  it('has sources to check', () => {
    expect(sources(ROOT).length).toBeGreaterThanOrEqual(4);
  });

  it.each(sources(ROOT).map((p) => [path.relative(ROOT, p), p]))('%s', (_name, file) => {
    const offenders = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => MUTATE.test(line) && MANIFEST_ROOT.test(line) && !ALLOWED.test(line));
    expect(offenders).toEqual([]);
  });

  it('the only fs writes in the tools go to the --out directory', () => {
    for (const file of sources(ROOT)) {
      const writes = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => MUTATE.test(line) && !/^\s*(\/\/|\*)/.test(line));
      for (const line of writes) expect(line).toMatch(ALLOWED);
    }
  });
});
