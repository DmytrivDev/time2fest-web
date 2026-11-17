import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs modules without types
import { collectAll, SEED_MAP } from '../../../scripts/boards/http-seeds.mjs';
// @ts-expect-error plain .mjs modules without types
import { listManifestFiles } from '../../../scripts/boards/lib/manifests.mjs';

const SCRIPT = 'scripts/boards/http-seeds.mjs';

describe('http-seeds', () => {
  it('maps every seed name used by the board manifests (read-only)', () => {
    const { named } = collectAll(listManifestFiles());
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(Object.keys(SEED_MAP)).toContain(n);
  });

  it('--all --dry lists the 6 names and exits 0', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--all', '--dry'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    for (const n of ['fresh', 'guest', 'user', 'pass', 'nick', 'authOther']) expect(r.stdout).toContain(`${n}:`);
  });

  it('an unknown seed name exits 1 and prints it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-'));
    try {
      const file = path.join(dir, 'fixture.json');
      fs.writeFileSync(file, JSON.stringify({ states: [{ id: 'x', seed: 'nope' }] }));
      const r = spawnSync(process.execPath, [SCRIPT, '--manifest', file, '--dry'], { encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('nope');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
