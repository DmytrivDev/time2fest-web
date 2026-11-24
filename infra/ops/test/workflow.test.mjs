// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
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

  it('declares the optional reason and catalogVersion string inputs (A-1: no repository_dispatch)', () => {
    expect(code.join('\n')).not.toMatch(/repository_dispatch/);
    for (const name of ['reason', 'catalogVersion']) {
      const at = code.findIndex((l) => new RegExp(`^ {6}${name}:\\s*$`).test(l));
      expect(at, name).toBeGreaterThanOrEqual(0);
      const body = code.slice(at + 1, at + 4).join('\n');
      expect(body).toMatch(/type:\s*string/);
      expect(body).toMatch(/required:\s*false/);
    }
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

  it('S2: runs only on master, inside the rehearsal GitHub Environment', () => {
    const job = code.findIndex((l) => /^ {2}deploy:\s*$/.test(l));
    expect(job).toBeGreaterThanOrEqual(0);
    const jobKeys = [];
    for (const l of code.slice(job + 1)) {
      if (/^ {0,2}\S/.test(l)) break;
      const m = l.match(/^ {4}([a-z-]+):\s*(.*)$/);
      if (m) jobKeys.push(`${m[1]}: ${m[2]}`.trim());
    }
    expect(jobKeys).toContain("if: github.ref == 'refs/heads/master'");
    expect(jobKeys).toContain('environment: rehearsal');
  });

  /** Назви кроків за порядком. */
  const steps = () => {
    const out = [];
    for (const l of code) {
      const named = l.match(/^ {6}- name:\s*(.+)$/);
      const used = l.match(/^ {6}- uses:\s*([^@\s]+)@/);
      if (named) out.push(named[1].trim());
      else if (used) out.push(used[1]);
    }
    return out;
  };

  it('S11: SSH material is written after the install, right before the deploy, and removed last', () => {
    expect(steps()).toEqual(['actions/checkout', 'actions/setup-node', 'Install pnpm', 'Install dependencies', 'SSH material', 'Deploy', 'Remove SSH material']);
  });

  it('S2: the last step removes the SSH material whatever the outcome', () => {
    const at = code.findIndex((l) => /^ {6}- name:\s*Remove SSH material\s*$/.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    const body = code.slice(at + 1);
    expect(body.some((l) => /^ {8}if:\s*always\(\)\s*$/.test(l))).toBe(true);
    expect(body.some((l) => /^ {8}run:\s*rm -f "\$RUNNER_TEMP"\/t2f_\* "\$HOME\/\.ssh\/id_ed25519"\s*$/.test(l))).toBe(true);
    // Копія ключа в ~/.ssh (ssh з `-F none` і без `-i` шукає її там) прибирається тим самим кроком.
    if (text.includes('$HOME/.ssh/id_ed25519')) expect(body.join('\n')).toContain('"$HOME/.ssh/id_ed25519"');
    // Обидва файли, що пише крок «SSH material», підпадають під шаблон t2f_*.
    for (const f of text.matchAll(/"\$RUNNER_TEMP\/(t2f_[a-z_]+)"/g)) expect(f[1]).toMatch(/^t2f_/);
  });

  it('has least permissions and calls pnpm deploy:env', () => {
    expect(text).toMatch(/^permissions:\n {2}contents:\s*read\s*$/m);
    expect(code.some((l) => /\brun:.*pnpm deploy:env/.test(l))).toBe(true);
  });
});

describe('all workflows (SPEC-13b AC-17, NFR-5)', () => {
  const dir = new URL('../../../.github/workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it('finds the workflows', () => {
    expect(files).toEqual(expect.arrayContaining(['deploy.yml', 'verify.yml']));
  });

  it.each(files)('%s has no T2F_TELEGRAM_* and no T2F_BACKUP_KEY', (f) => {
    const body = readFileSync(new URL(f, dir), 'utf8');
    expect(body).not.toMatch(/T2F_TELEGRAM_/);
    expect(body).not.toMatch(/T2F_BACKUP_KEY/);
  });
});
