import fs from 'node:fs';
import path from 'node:path';

const BT_REL = path.join('docs', 'bmad', 'planning-artifacts', 'ux-designs', 'ux-Time2Fest-2026-10-21', 'board-tools');

/** Board-tools root: `T2F_BT_DIR`, else the first ancestor of the cwd that holds the project board-tools folder. */
export function btDir() {
  if (process.env.T2F_BT_DIR) return process.env.T2F_BT_DIR;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, BT_REL);
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) throw new Error('board-tools folder not found; set T2F_BT_DIR');
    dir = up;
  }
}

/** Manifest root (read-only: this module and its callers only read it). */
export function manifestsDir() {
  return path.join(btDir(), 'manifests');
}

export function listManifestFiles() {
  const dir = manifestsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadManifest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Seeds used by a manifest: named (strings, also inside arrays) and inline objects (client-only). */
export function collectSeeds(manifest) {
  const named = new Set();
  let clientOnly = 0;
  const add = (x) => {
    if (typeof x === 'string') named.add(x);
    else if (Array.isArray(x)) x.forEach(add);
    else if (x && typeof x === 'object') clientOnly++;
  };
  add(manifest.defaults?.seed);
  for (const s of manifest.states ?? []) add(s.seed);
  return { named, clientOnly };
}
