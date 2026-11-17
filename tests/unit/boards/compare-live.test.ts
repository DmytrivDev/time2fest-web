import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error pngjs ships no type declarations
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs module without types
import { run } from '../../../scripts/boards/compare-live.mjs';

const SIZE = 100;
let tmp: string;

/** 100x100 white image with `n` black pixels in row 0 starting at column `x0`, or an all-white image. */
function png(n: number, x0 = 0): Buffer {
  const img = new PNG({ width: SIZE, height: SIZE });
  img.data.fill(255);
  for (let i = 0; i < n; i++) {
    const o = (0 * SIZE + x0 + i) * 4;
    img.data[o] = 0;
    img.data[o + 1] = 0;
    img.data[o + 2] = 0;
  }
  return PNG.sync.write(img);
}

function setup(): { ref: string; cur: string; out: string; masks: string } {
  const ref = path.join(tmp, 'ref');
  const cur = path.join(tmp, 'new');
  fs.mkdirSync(ref);
  fs.mkdirSync(cur);
  for (const [id, n] of [['a-five', 5], ['b-thirty', 30], ['c-eighty', 80]] as const) {
    fs.writeFileSync(path.join(ref, `${id}.live.png`), png(0));
    fs.writeFileSync(path.join(cur, `${id}.live.png`), png(n));
  }
  return { ref, cur, out: path.join(tmp, 'out'), masks: path.join(tmp, 'masks.json') };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boards-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('compare-live', () => {
  it('classes 0.05 % pass, 0.3 % triage, 0.8 % defect and writes three .fid.png', () => {
    const { ref, cur, out, masks } = setup();
    const { results, failed } = run({ ref, new: cur, ids: 'a-five,b-thirty,c-eighty', out, tol: 24, masks });
    const byId = Object.fromEntries(results.map((r: { id: string; class: string }) => [r.id, r.class]));
    expect(byId).toEqual({ 'a-five': 'pass', 'b-thirty': 'triage', 'c-eighty': 'defect' });
    expect(failed).toBe(true);
    for (const id of ['a-five', 'b-thirty', 'c-eighty']) expect(fs.existsSync(path.join(out, `${id}.fid.png`))).toBe(true);
    const report = JSON.parse(fs.readFileSync(path.join(out, 'compare-live.json'), 'utf8'));
    expect(report).toHaveLength(3);
  });

  it('a mask over the 30-pixel area gives pass', () => {
    const { ref, cur, out, masks } = setup();
    fs.writeFileSync(masks, JSON.stringify({ masks: { 'b-*': [[0, 0, 30, 1]] } }));
    const { results } = run({ ref, new: cur, ids: 'b-thirty', out, tol: 24, masks });
    expect(results[0].class).toBe('pass');
    expect(results[0].pct).toBe(0);
  });

  it('a missing image is reported and fails the run', () => {
    const { ref, cur, out, masks } = setup();
    const { results, failed } = run({ ref, new: cur, ids: 'nope', out, tol: 24, masks });
    expect(results[0].class).toBe('missing');
    expect(failed).toBe(true);
  });

  it('--help exits 0', () => {
    const r = spawnSync(process.execPath, ['scripts/boards/compare-live.mjs', '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage');
  });
});
