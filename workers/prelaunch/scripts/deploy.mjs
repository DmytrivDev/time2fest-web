// Викладає передстартовий сайт (out-prelaunch) у Worker t2f-prelaunch.
//   node workers/prelaunch/scripts/deploy.mjs [--dry-run]
// Перед викладенням дописує в out-prelaunch/_headers правило для технічної адреси *.workers.dev:
// `X-Robots-Tag: noindex` лише для цього хоста (на time2fest.com не діє). Маршрутів і власних доменів у
// wrangler.json немає — цей скрипт домену не торкається; домен підключається окремо (етап 2, docs/services/cloudflare.md).
// Токен — лише зі змінної середовища CLOUDFLARE_API_TOKEN, в аргументи й вивід не потрапляє.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.resolve(PKG, '..', '..');
const OUT = path.join(WEB, 'out-prelaunch');
const WRANGLER_JS = path.join(WEB, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const MARK = '# t2f-prelaunch: технічна адреса не індексується';
const RULE = `\n${MARK}\nhttps://t2f-prelaunch.:subdomain.workers.dev/*\n  X-Robots-Tag: noindex\n`;

if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.error('deploy: немає out-prelaunch — спершу pnpm build:prelaunch:domain');
  process.exit(1);
}
const hf = path.join(OUT, '_headers');
const cur = fs.existsSync(hf) ? fs.readFileSync(hf, 'utf8') : '';
if (!cur.includes(MARK)) fs.writeFileSync(hf, cur.replace(/\s*$/, '\n') + RULE);
// Workers рахує динамічними (ліміт 100) усі правила `_redirects` після першого правила з `*` чи `:плейсхолдером`;
// генератор (scripts/prelaunch/seo-files.mjs) ставить їх у кінець — тут лише перевірка.
const rf = path.join(OUT, '_redirects');
if (fs.existsSync(rf)) {
  const rules = fs.readFileSync(rf, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const isDyn = (l) => /[*]|\/:[a-z]/i.test(l.trim().split(/\s+/)[0] ?? '');
  const first = rules.findIndex(isDyn);
  if (first >= 0 && !rules.slice(first).every(isDyn)) {
    console.error('deploy: у _redirects точне правило стоїть після динамічного — перезбери (pnpm build:prelaunch:domain)');
    process.exit(1);
  }
}
if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('deploy: немає CLOUDFLARE_API_TOKEN у середовищі');
  process.exit(1);
}
const args = [WRANGLER_JS, 'deploy', '-c', path.join(PKG, 'wrangler.json')];
if (process.argv.includes('--dry-run')) args.push('--dry-run');
const r = spawnSync(process.execPath, args, { cwd: PKG, stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
