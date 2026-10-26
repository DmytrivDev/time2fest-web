/**
 * Правило однієї коралової кнопки (ІНВ 5.3): на екрані видимих `[data-variant="coral"]` не більше однієї.
 * Викликається з `afterEach` у preview.tsx для історій сторінок і вікон; можна викликати й з власного `play`.
 */
export function visibleCoral(root: ParentNode): Element[] {
  return [...root.querySelectorAll('[data-variant="coral"]')].filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  });
}

export function assertSingleCoral(root: ParentNode): void {
  const found = visibleCoral(root);
  if (found.length > 1) {
    const names = found.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()).join(' | ');
    throw new Error(`Правило однієї коралової кнопки: видимих ${found.length} (${names}). Має бути ≤ 1.`);
  }
}

/** Історії з цими префіксами назви (або тегами `page` / `window`) вважаються сторінками й вікнами. */
export function isPageOrWindowStory(title: string, tags: readonly string[] = []): boolean {
  return /^(Сторінки|Вікна)\//.test(title) || tags.includes('page') || tags.includes('window');
}
