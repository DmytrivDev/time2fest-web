// Перевірка збірки (SPEC-06, AC-56): центральний бандл не має містити centrifuge-js.
// Використання: node scripts/check-bundle.mjs <dir>. Коди виходу: 0 — чисто, 1 — знайдено підпис, 2 — немає теки або аргументу.
import fs from 'node:fs';
import path from 'node:path';

const SIGNATURES = [
  'WebSocket constructor not found, make sure it is available globally or passed as a dependency in Centrifuge options',
  'token expired but no getToken function set in the configuration',
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) yield full;
  }
}

const dir = process.argv[2];
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
  console.error('check-bundle: centrifuge-js found in:');
  for (const f of hits) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-bundle: clean (${count} files)`);
