#!/usr/bin/env node
// Pixel-compares reference live shots with shots from the http build (AC-85, AC-86).
// Reads <ref>/<id>.live.png and <new>/<id>.live.png; writes <out>/<id>.fid.png and <out>/compare-live.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffPngs } from './lib/png.mjs';

const HELP = `Usage: node scripts/boards/compare-live.mjs --ref <dir> --new <dir> --ids a,b|@file --out <dir> [--tol 24] [--masks scripts/boards/masks.json]
class: pass <= 0.1 %, triage 0.1-0.5 %, defect > 0.5 %. Exit 1 if any id is a defect or missing.`;

function parseArgs(argv) {
  const args = { tol: 24, masks: 'scripts/boards/masks.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  args.tol = Number(args.tol);
  return args;
}

export function classify(pct) {
  return pct <= 0.1 ? 'pass' : pct <= 0.5 ? 'triage' : 'defect';
}

function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

function masksFor(id, maskFile) {
  if (!maskFile || !fs.existsSync(maskFile)) return [];
  const { masks = {} } = JSON.parse(fs.readFileSync(maskFile, 'utf8'));
  return Object.entries(masks)
    .filter(([glob]) => globToRe(glob).test(id))
    .flatMap(([, rects]) => rects);
}

function readIds(spec) {
  const raw = spec.startsWith('@') ? fs.readFileSync(spec.slice(1), 'utf8') : spec;
  return raw.split(/[,\r\n]+/).map((s) => s.trim()).filter(Boolean);
}

export function run(args) {
  const ids = readIds(args.ids);
  fs.mkdirSync(args.out, { recursive: true });
  const results = [];
  let failed = false;
  for (const id of ids) {
    const refFile = path.join(args.ref, `${id}.live.png`);
    const newFile = path.join(args.new, `${id}.live.png`);
    if (!fs.existsSync(refFile) || !fs.existsSync(newFile)) {
      results.push({ id, pct: null, class: 'missing' });
      failed = true;
      continue;
    }
    const { pct, diffPng } = diffPngs(fs.readFileSync(refFile), fs.readFileSync(newFile), {
      tol: args.tol,
      masks: masksFor(id, args.masks),
    });
    fs.writeFileSync(path.join(args.out, `${id}.fid.png`), diffPng);
    const cls = classify(pct);
    if (cls === 'defect') failed = true;
    results.push({ id, pct, class: cls });
  }
  fs.writeFileSync(path.join(args.out, 'compare-live.json'), JSON.stringify(results, null, 2));
  return { results, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.ref || !args.new || !args.ids || !args.out) {
    console.error(HELP);
    process.exit(2);
  }
  const { results, failed } = run(args);
  for (const r of results) console.log(`${r.class.padEnd(7)} ${r.pct === null ? '-' : r.pct.toFixed(3)}%  ${r.id}`);
  process.exit(failed ? 1 : 0);
}
