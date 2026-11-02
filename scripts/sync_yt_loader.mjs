// Копіює завантажувач YouTube IFrame API (`https://www.youtube.com/iframe_api`, ~1 КБ) у `public/yt/iframe_api.js`
// без змін (рішення власника 2026-11-02). Сам завантажувач на youtube.com ставить стежувальні cookies YouTube ще до згоди;
// з нашого домену — ні. Решту (основний скрипт плеєра з youtube.com/s/player/…, iframe з youtube-nocookie.com) він
// підвантажує сам — вони cookies не ставлять.
// Запуск: node scripts/sync_yt_loader.mjs — сам іде перед кожною збіркою (`prebuild`): YouTube час від часу міняє
// адресу основного скрипта. Немає мережі чи відповідь дивна — лишаємо збережену копію і лише попереджаємо.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://www.youtube.com/iframe_api';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'yt', 'iframe_api.js');

try {
  const res = await fetch(SRC, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Перевірка, що це справді завантажувач, а не сторінка помилки чи згоди.
  if (!/www-widgetapi\.js/.test(text) || !text.includes('onYTReady') || text.length > 20_000) throw new Error('неочікуваний вміст');
  const prev = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (prev === text) {
    console.log('yt loader: без змін');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(`yt loader: оновлено (${text.length} Б)`);
  }
} catch (e) {
  if (!existsSync(out)) {
    console.error(`yt loader: не вдалося завантажити (${e.message}), а збереженої копії немає`);
    process.exit(1);
  }
  console.warn(`yt loader: не вдалося оновити (${e.message}) — лишаю збережену копію`);
}
