#!/usr/bin/env node
// Maps the named seeds of the board manifests to test-door calls on the http server (AC-84).
// Manifests are only read. Inline object seeds are client-side localStorage and listed as client-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSeeds, listManifestFiles, loadManifest } from './lib/manifests.mjs';

/**
 * In this wave every seed needs only the catalog, which the reset door re-seeds;
 * users, passes and stamps are still `sim`. Later waves extend the lists, keeping all names mapped.
 */
export const SEED_MAP = {
  fresh: [{ door: 'reset' }],
  guest: [{ door: 'reset' }],
  user: [{ door: 'reset' }],
  pass: [{ door: 'reset' }],
  nick: [{ door: 'reset' }],
  authOther: [{ door: 'reset' }],
};

const HELP = 'Usage: node scripts/boards/http-seeds.mjs (--manifest <path> | --all) [--server http://127.0.0.1:<port>] [--dry]';

export function collectAll(files) {
  const named = new Set();
  let clientOnly = 0;
  for (const f of files) {
    const s = collectSeeds(loadManifest(f));
    s.named.forEach((n) => named.add(n));
    clientOnly += s.clientOnly;
  }
  return { named: [...named].sort(), clientOnly };
}

export async function main(argv, io = { log: console.log, error: console.error }) {
  const args = { dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--all') args.all = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--server') args.server = argv[++i];
  }
  if (args.help) {
    io.log(HELP);
    return 0;
  }
  if (!args.all && !args.manifest) {
    io.error(HELP);
    return 2;
  }
  const files = args.all ? listManifestFiles() : [path.resolve(args.manifest)];
  const { named, clientOnly } = collectAll(files);
  const unknown = named.filter((n) => !Object.hasOwn(SEED_MAP, n));
  if (unknown.length) {
    io.error(`unknown seed: ${unknown.join(', ')}`);
    return 1;
  }
  for (const n of named) io.log(`${n}: ${SEED_MAP[n].map((c) => c.door).join(', ')}`);
  io.log(`client-only inline seeds: ${clientOnly}`);
  if (args.dry) return 0;
  if (!args.server) {
    io.error('--server is required without --dry');
    return 2;
  }
  const res = await fetch(`${args.server}/api/_test/reset`, { method: 'POST' });
  if (!res.ok) {
    io.error(`reset failed: HTTP ${res.status}`);
    return 1;
  }
  io.log('reset done');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
