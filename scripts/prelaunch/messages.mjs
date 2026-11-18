// Звіт про тексти мовного дерева: яких ключів бракує в messages/<мова>.json проти українського джерела.
// Збірка на відсутніх ключах не падає (показує англійський, далі український текст) — цей скрипт каже, чого бракує.
//   node scripts/prelaunch/messages.mjs                 звіт по всіх мовах (код 0)
//   node scripts/prelaunch/messages.mjs --strict en,uk  код 1, якщо в названих мовах бракує ключів
//   node scripts/prelaunch/messages.mjs --source <файл> записати українське джерело для перекладу
//   node scripts/prelaunch/messages.mjs --json <файл>   записати звіт у файл
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatKeys, missingKeys, rawMessages } from '../../lib/prelaunch/messageSet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (l) => JSON.parse(fs.readFileSync(path.join(root, 'messages', `${l}.json`), 'utf8'));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? '');
};

// Порівнюємо файли як є: правки `prelaunch.<простір>` перекладаються окремими ключами, як в uk.json.
const source = rawMessages(read('uk'));
const total = flatKeys(source).length;

const sourceOut = arg('--source');
if (sourceOut) {
  fs.writeFileSync(sourceOut, `${JSON.stringify(source, null, 2)}\n`);
  console.log(`messages: source (${total} keys) -> ${sourceOut}`);
  process.exit(0);
}

const report = { total, locales: {} };
for (const locale of ['en', 'es', 'fr']) {
  // `prelaunch.overrides` — необов’язкові правки наявних текстів (тон «ти» українською), не переклад.
  const missing = missingKeys(source, rawMessages(read(locale))).filter((k) => !k.startsWith('prelaunch.overrides.'));
  report.locales[locale] = { missing: missing.length, keys: missing };
  console.log(
    `messages: ${locale} — ${total - missing.length}/${total} keys${missing.length ? `, missing ${missing.length}` : ''}`,
  );
  if (missing.length && missing.length <= 40) for (const k of missing) console.log(`  - ${k}`);
  else if (missing.length) {
    const byNs = {};
    for (const k of missing) {
      const ns = k.split('.').slice(0, 2).join('.');
      byNs[ns] = (byNs[ns] ?? 0) + 1;
    }
    for (const [ns, n] of Object.entries(byNs)) console.log(`  - ${ns}.* — ${n}`);
  }
}
const jsonOut = arg('--json');
if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
  fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 1)}\n`);
}
const strict = arg('--strict');
if (strict !== null) {
  const bad = strict.split(',').filter((l) => report.locales[l]?.missing);
  if (bad.length) {
    console.error(`messages: missing keys in ${bad.join(', ')}`);
    process.exit(1);
  }
}
