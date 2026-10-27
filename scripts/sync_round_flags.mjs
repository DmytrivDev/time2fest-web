// Копіює кругові прапори з пакета `circle-flags` (HatScripts, MIT) у `public/flags/round/` — лише для чату.
// Запуск: node scripts/sync_round_flags.mjs (після зміни версії пакета). Без CDN: файли віддаються з нашого домену.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'circle-flags', 'flags');
const to = join(root, 'public', 'flags', 'round');
// Усі ISO-країни (дві літери, у т. ч. `eu`) і особливі: Англія, Шотландія, Уельс, Пн. Ірландія, ООН, Косово.
const keep = (name) => /^[a-z]{2}\.svg$/.test(name) || ['gb-eng.svg', 'gb-sct.svg', 'gb-wls.svg', 'gb-nir.svg', 'un.svg', 'xk.svg'].includes(name);

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
let n = 0;
let bytes = 0;
for (const name of readdirSync(from)) {
  if (!keep(name) || !statSync(join(from, name)).isFile()) continue;
  copyFileSync(join(from, name), join(to, name));
  bytes += statSync(join(to, name)).size;
  n += 1;
}
console.log(`round flags: ${n} files, ${Math.round(bytes / 1024)} KB -> public/flags/round`);
