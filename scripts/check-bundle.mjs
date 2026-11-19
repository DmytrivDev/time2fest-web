// Перевірка збірки (SPEC-06 AC-56, SPEC-07 AC-58): центральний бандл не має містити centrifuge-js,
// а жодна не тестова збірка — шляху дверцят `/api/_test/` і ключа машини часу.
// Використання: node scripts/check-bundle.mjs <dir> [--allow-realtime]. Коди виходу: 0 — чисто, 1 — знайдено підпис, 2 — немає теки або аргументу.
// `--allow-realtime` — збірка репетиції: підписи centrifuge дозволені, решта діє.
import fs from 'node:fs';
import path from 'node:path';

const REALTIME_SIGNATURES = [
  'WebSocket constructor not found, make sure it is available globally or passed as a dependency in Centrifuge options',
  'token expired but no getToken function set in the configuration',
];
// `zqxfallbackctl7` — контрольне слово розширеного запасного списку (SPEC-09 AC-6): лише в `extended-words.ts`.
const TEST_SIGNATURES = ['/api/_test/', 't2f:session:timeMachine', 'zqxfallbackctl7'];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) yield full;
  }
}

const args = process.argv.slice(2);
const allowRealtime = args.includes('--allow-realtime');
const SIGNATURES = allowRealtime ? TEST_SIGNATURES : [...REALTIME_SIGNATURES, ...TEST_SIGNATURES];
const dir = args.find((a) => !a.startsWith('--'));
if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`check-bundle: directory not found: ${dir ?? '(no argument)'} — run the build first`);
  process.exit(2);
}

let count = 0;
const hits = [];
for (const file of walk(dir)) {
  count += 1;
  const text = fs.readFileSync(file, 'utf8');
  if (SIGNATURES.some((s) => text.includes(s))) hits.push(file);
}

if (hits.length > 0) {
  console.error('check-bundle: forbidden signature (centrifuge-js, test door or time machine) found in:');
  for (const f of hits) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-bundle: clean (${count} files)`);
