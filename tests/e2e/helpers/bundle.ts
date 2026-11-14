/**
 * Пошук рядка в зібраному пакеті JS (`out/_next/static`) — для перевірки, що тестові інструменти
 * не потрапили в робочу збірку (US8.2, T083).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Тека збірки — `out` (проєкт `prod`); `T2F_OUT_DIR` — інша тека (перевірка окремої збірки). */
export const STATIC_DIR = resolve(process.cwd(), process.env.T2F_OUT_DIR ?? 'out', '_next', 'static');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** Файли `.js` пакета, що містять `needle`. */
export function bundleFilesContaining(needle: string, dir = STATIC_DIR): string[] {
  const hits: string[] = [];
  for (const file of walk(dir)) if (readFileSync(file, 'utf8').includes(needle)) hits.push(file);
  return hits;
}
