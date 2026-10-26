// Копіює токени дизайну в web/styles. З --check лише перевіряє, що копії актуальні.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../docs/bmad/planning-artifacts/ux-designs/ux-Time2Fest-2026-10-21/tokens');
const dst = resolve(here, '../styles');
const header = '/* ГЕНЕРУЄТЬСЯ (pnpm sync:tokens), не редагувати. Джерело: docs/bmad/.../tokens/ */\n';
const check = process.argv.includes('--check');
let failed = false;

for (const name of ['tokens.css', 'typography.css']) {
  const from = resolve(src, name);
  const to = resolve(dst, name);
  if (!existsSync(from)) {
    // репозиторій web/ окремо від документів: джерела немає — пропускаємо перевірку
    console.warn(`[sync:tokens] немає джерела ${name}, пропуск`);
    continue;
  }
  const expected = header + readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
  if (check) {
    const actual = existsSync(to) ? readFileSync(to, 'utf8').replace(/\r\n/g, '\n') : '';
    if (actual !== expected) {
      console.error(`[sync:tokens] ${name} застарів: виконай pnpm sync:tokens`);
      failed = true;
    }
  } else {
    writeFileSync(to, expected);
    console.log(`[sync:tokens] ${name} оновлено`);
  }
}
process.exit(failed ? 1 : 0);
