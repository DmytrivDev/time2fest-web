// Тексти мовного дерева (`app/[locale]`): які простори `messages/*.json` йому потрібні і як складається набір мови.
// Спільне для сайту (`lib/prelaunch/messages.ts`) і скрипта звіту (`scripts/prelaunch/messages.mjs`); без залежностей.

/** Простори, якими користуються сторінки мовного дерева (решта `uk.json` — ефір, вхід, кабінет — сюди не йде). */
export const NAMESPACES = [
  'common',
  'primitives',
  'a11y',
  'states',
  'nav',
  'liveMap',
  'prefest',
  'prelaunch',
];

const isTree = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Глибоке злиття: пізніший шар перекриває раніший; порожній рядок не перекриває. */
export function mergeMessages(base, ...layers) {
  const out = isTree(base) ? { ...base } : {};
  for (const layer of layers) {
    if (!isTree(layer)) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (isTree(v)) out[k] = mergeMessages(out[k], v);
      else if (typeof v === 'string' && v !== '') out[k] = v;
    }
  }
  return out;
}

/**
 * Українське джерело мовного дерева: потрібні простори `uk.json`, де спільні простори перекрито правками
 * передстартового сайту: `prelaunch.<простір>` (`prelaunch.prefest`, `prelaunch.nav`). Сторінки поза мовним
 * деревом (`/before`, ефір) читають ці простори без правок і тому не змінюються.
 */
/** Лише простори мовного дерева з файла мови, без накладання правок (для звіту про відсутні ключі). */
export function rawMessages(messages) {
  return Object.fromEntries(NAMESPACES.filter((ns) => isTree(messages?.[ns])).map((ns) => [ns, messages[ns]]));
}

export function sourceMessages(uk) {
  const out = rawMessages(uk);
  const prelaunch = { ...(out.prelaunch ?? {}) };
  for (const ns of NAMESPACES) {
    if (ns === 'prelaunch' || !isTree(prelaunch[ns])) continue;
    out[ns] = mergeMessages(out[ns], prelaunch[ns]);
    delete prelaunch[ns];
  }
  out.prelaunch = prelaunch;
  return out;
}

/** Набір мови: українське джерело ← англійська ← сама мова (чого немає в мові — показуємо англійською). */
export function localeMessages(locale, files) {
  if (locale === 'uk') return sourceMessages(files.uk);
  // Спершу зливаємо файли (uk ← en ← мова), потім накладаємо правки `prelaunch.<простір>` — уже цієї мови.
  const layers = locale === 'en' ? [files.en] : [files.en, files[locale]];
  return sourceMessages(mergeMessages(rawMessages(files.uk), ...layers.map(rawMessages)));
}

export function flatKeys(tree, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(tree ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isTree(v)) out.push(...flatKeys(v, p));
    else out.push(p);
  }
  return out;
}

/** Ключі джерела, яких немає у файлі мови (або там порожній рядок). */
export function missingKeys(source, messages) {
  const at = (key) => key.split('.').reduce((o, p) => (isTree(o) ? o[p] : undefined), messages);
  return flatKeys(source).filter((k) => {
    const v = at(k);
    return typeof v !== 'string' || v === '';
  });
}
