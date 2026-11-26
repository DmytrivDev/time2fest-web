#!/usr/bin/env node
// Maps the named seeds of the board manifests to test-door calls on the http server (AC-84).
// Manifests are only read. Inline object seeds are client-side localStorage and listed as client-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSeeds, listManifestFiles, loadManifest } from './lib/manifests.mjs';

/**
 * Seeds -> test-door calls (SPEC-11: `auth` and `profile` are http, so account state is server state).
 * `user` = sign in once as olena@example.com (code flow: `auth/free-gap`, send code, `auth/last-code`, verify) and write the
 * profile (nick Олена, flag UA) with `rights/profile-seed`; `pass` = `user` + `rights/pass-grant` (holder = the account) and the
 * schedule from the seed; a board that must show NO pass first deletes the account's pass rows (revoke is clock-relative).
 * `nick` = guest profile via `rights/profile-seed` (subject = the guest id of `GET /api/auth/get-session`).
 * `authOther` (google account + unattached device pass) has no preset yet: boards using it are not run over http.
 * Inline object seeds are localStorage of the still-sim domains (chat, passport, notifications, toasts) and stay client-side.
 * Guests created by earlier boards are removed (`profiles` rows) so a nick can be taken again.
 */
export const SEED_MAP = {
  fresh: [{ door: 'reset' }],
  guest: [{ door: 'reset' }],
  user: [{ door: 'auth/free-gap' }, { door: 'auth/last-code' }, { door: 'rights/profile-seed' }],
  pass: [{ door: 'auth/free-gap' }, { door: 'auth/last-code' }, { door: 'rights/profile-seed' }, { door: 'rights/pass-grant' }],
  nick: [{ door: 'rights/profile-seed' }],
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
