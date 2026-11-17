/**
 * Розкладка блоку «Як зустрічають Новий рік у світі» на головній «до свята»: скільки карток країн показати і чи
 * потрібна остання картка «Скоро більше країн». Показуємо лише країни з власним описом.
 */

export interface CardLayout {
  /** Скільки карток країн показати. */
  cards: number;
  /** Чи додавати картку «Скоро більше країн». */
  soon: boolean;
  /** Колонок у сітці. */
  columns: 2 | 4;
  /** Чи показувати блок узагалі. */
  visible: boolean;
}

/** Максимум карток країн у двох рядах по чотири. */
export const MAX_CARDS = 8;

export function cardLayout(describedCount: number): CardLayout {
  const n = Math.max(0, Math.floor(describedCount));
  if (n === 0) return { cards: 0, soon: false, columns: 4, visible: false };
  if (n <= 2) return { cards: n, soon: true, columns: 2, visible: true };
  if (n <= 5) return { cards: Math.min(n, 3), soon: true, columns: 4, visible: true };
  return { cards: Math.min(n, MAX_CARDS), soon: false, columns: 4, visible: true };
}

/** Відомі країни, чиї прапори стоять у картці «Скоро»: ті з них, що ще без опису (до трьох). */
export const SOON_CANDIDATES: readonly string[] = ['UA', 'DE', 'IT', 'FR', 'GB', 'ES', 'US', 'BR', 'JP'];

export function soonFlagIsos(describedIsos: Iterable<string>, count = 3): string[] {
  const done = new Set(describedIsos);
  return SOON_CANDIDATES.filter((iso) => !done.has(iso)).slice(0, count);
}

/** Показувати число «Усі країни · N» лише коли описаних країн щонайменше шість. */
export function showDescribedCount(describedCount: number): boolean {
  return describedCount >= 6;
}
