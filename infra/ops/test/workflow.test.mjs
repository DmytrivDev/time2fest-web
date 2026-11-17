// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = text.split('\n').filter((l) => !/^\s*#/.test(l));

/** @param {string} l */
const indentOf = (l) => l.length - l.trimStart().length;

describe('deploy workflow', () => {
  it('is triggered only by workflow_dispatch', () => {
    const start = code.findIndex((l) => /^on:\s*$/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    const triggers = [];
    for (const l of code.slice(start + 1)) {
      if (/^\S/.test(l)) break;
      if (/^ {2}[a-z_]+:/.test(l)) triggers.push(l.trim());
    }
    expect(triggers).toEqual(['workflow_dispatch:']);
    expect(code.join('\n')).not.toMatch(/pull_request_target|^\s*push:|^\s*schedule:/m);
  });

  it('limits the env input to a choice of exactly [rehearsal]', () => {
    expect(text).toMatch(/type:\s*choice/);
    expect(text).toMatch(/options:\s*\[\s*rehearsal\s*\]/);
  });

  it('pins every action by 40-hex SHA', () => {
    const uses = code.filter((l) => /\buses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/@[0-9a-f]{40}\b/);
  });

  it('references secrets only under an env: key', () => {
    let envIndent = -1;
    for (const l of code) {
      const indent = indentOf(l);
      if (/^\s*env:\s*$/.test(l)) {
        envIndent = indent;
        continue;
      }
      if (envIndent >= 0 && l.trim() !== '' && indent <= envIndent) envIndent = -1;
      if (/\$\{\{\s*secrets\./.test(l)) expect(envIndent, l).toBeGreaterThanOrEqual(0);
    }
  });

  it('never interpolates ${{ }} inside run:', () => {
    let runIndent = -1;
    for (const l of code) {
      const indent = indentOf(l);
      if (runIndent >= 0 && l.trim() !== '' && indent <= runIndent) runIndent = -1;
      if (/^\s*(- )?run:/.test(l)) {
        runIndent = indent;
        expect(l).not.toContain('${{');
        continue;
      }
      if (runIndent >= 0) expect(l).not.toContain('${{');
    }
  });

  it('has least permissions and calls pnpm deploy:env', () => {
    expect(text).toMatch(/^permissions:\n {2}contents:\s*read\s*$/m);
    expect(code.some((l) => /\brun:.*pnpm deploy:env/.test(l))).toBe(true);
  });
});
