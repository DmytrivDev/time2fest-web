/**
 * `pnpm --dir server seed`: seeds the database of `DATABASE_URI` (from `.env.local` when the
 * shell has none) and prints the row count of each seeded collection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeed } from './index';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main(): Promise<void> {
  loadEnvFile(path.join(serverDir, '.env.local'));
  const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../payload.config')]);
  const payload = await getPayload({ config });
  try {
    const counts = await runSeed(payload);
    const keys = Object.keys(counts).sort();
    process.stdout.write(keys.length === 0 ? 'seed: no rows registered\n' : keys.map((k) => `seed: ${k} ${counts[k]}\n`).join(''));
  } finally {
    await payload.destroy();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`seed: failed — ${err instanceof Error ? err.message : 'unknown error'}\n`);
    process.exit(1);
  },
);
