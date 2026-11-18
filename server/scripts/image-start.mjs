// @ts-check
/**
 * Start command of the server image (SPEC-13a AC-1, AC-2): `CMD ["node","scripts/image-start.mjs"]`.
 * Unlike `stack.mjs` it derives nothing from the checkout (the image has no VCS metadata and no
 * slots): the listen address comes from `T2F_HOST` / `T2F_SERVER_PORT` (class `test`: loopback),
 * and outside class `test` the image commit `T2F_COMMIT` must be 40 hex. A failure prints the
 * variable names only and exits 1 before anything listens. Full env validation runs on boot in
 * `instrumentation.ts`, which also exits 1 naming variables.
 * Spawns `next start` with a fixed argv and no shell; forwards SIGINT/SIGTERM; exits with the
 * child's code.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenAddress } from './lib/listen.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = /^[0-9a-f]{40}$/;

const address = listenAddress(process.env);
if ('failing' in address) {
  console.error(`env: invalid ${address.failing.join(', ')}`);
  process.exit(1);
}
if (process.env.T2F_ENV !== 'test' && !COMMIT.test(process.env.T2F_COMMIT ?? '')) {
  console.error('env: invalid T2F_COMMIT');
  process.exit(1);
}

const nextBin = path.join(serverDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, 'start', '-p', String(address.port), '-H', address.host], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
console.log(`[image-start] next start on ${address.host}:${address.port}`);

for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
child.on('error', () => {
  console.error('[image-start] next could not be started');
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
