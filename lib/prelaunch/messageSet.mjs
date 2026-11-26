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
  // Меню передстартового сайту — бічне вікно меню сайту (`SideDialog`) з його підписами. Простору `header` тут бути
  // не може: `prelaunch.header` — власні тексти шапки, а не правка простору `header` (злиття їх стерло б).
  'menu',
];

/**
 * Частини інших просторів, якими користуються наявні компоненти сайту на сторінках мовного дерева (пас, тости,
 * країни, сторінка країни). Беремо лише ці гілки — решту простору (оплата, вхід, ефір) не тягнемо й не перекладаємо.
 */
export const SUBTREES = [
  'pass.page',
  'pass.perks',
  'pass.faq',
  'legal',
  'countries',
  'country.header',
  'country.howTo',
  'country.faq',
  'country.streams',
  'player.scene',
  'liveCards.howTo',
  'liveCards.nowNext',
];

/** Ключі простору `menu`, яких мовне дерево не показує (тости). */
const DROPPED_MENU_KEYS = ['toasts', 'toastsHint'];

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
  const out = Object.fromEntries(
    NAMESPACES.filter((ns) => isTree(messages?.[ns])).map((ns) => [ns, messages[ns]]),
  );
  for (const path of SUBTREES) {
    const parts = path.split('.');
    const value = parts.reduce((o, p) => (isTree(o) ? o[p] : undefined), messages);
    if (value === undefined) continue;
    let o = out;
    for (const p of parts.slice(0, -1)) o = o[p] = isTree(o[p]) ? { ...o[p] } : {};
    o[parts.at(-1)] = value;
  }
  return out;
}

export function sourceMessages(uk) {
  const out = rawMessages(uk);
  const prelaunch = { ...(out.prelaunch ?? {}) };
  // Перекриття — лише для просторів мовного дерева (`prelaunch.prefest`, `prelaunch.nav`); `prelaunch.pass`,
  // `prelaunch.country` тощо — власні тексти передстартового сайту, а не правки просторів `pass` / `country`.
  const roots = NAMESPACES;
  for (const ns of roots) {
    if (ns === 'prelaunch' || !isTree(prelaunch[ns])) continue;
    out[ns] = mergeMessages(out[ns], prelaunch[ns]);
    delete prelaunch[ns];
  }
  // `prelaunch.overrides` — правки наявних текстів інших просторів (тон «ти», підпис сцени до запуску трансляцій).
  if (isTree(prelaunch.overrides)) {
    for (const [ns, tree] of Object.entries(prelaunch.overrides))
      out[ns] = mergeMessages(out[ns], tree);
    delete prelaunch.overrides;
  }
  out.prelaunch = prelaunch;
  // Тостів цього сезону немає (рішення власника 2026-11-26): їхні підписи меню сайту в набір мовного дерева не йдуть.
  if (isTree(out.menu)) {
    out.menu = { ...out.menu };
    for (const k of DROPPED_MENU_KEYS) delete out.menu[k];
  }
  return out;
}

/** Набір мови: українське джерело ← англійська ← сама мова (чого немає в мові — показуємо англійською). */
export function localeMessages(locale, files) {
  if (locale === 'uk') return sourceMessages(files.uk);
  // Спершу зливаємо файли (uk ← en ← мова), потім накладаємо правки `prelaunch.<простір>` — уже цієї мови.
  // Правки `prelaunch.overrides` (тон «ти» тощо) — лише з файла самої мови: українські не просочуються в інші мови.
  const withoutOverrides = (m) => {
    const r = rawMessages(m);
    if (isTree(r.prelaunch)) {
      r.prelaunch = { ...r.prelaunch };
      delete r.prelaunch.overrides;
    }
    return r;
  };
  const own = rawMessages(files[locale] ?? {});
  const base = mergeMessages(
    withoutOverrides(files.uk),
    ...(locale === 'en' ? [] : [withoutOverrides(files.en)]),
    own,
  );
  return sourceMessages(base);
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
