/** Чисті правила пошти (і інтерфейс, і «сервер» імітації; сервер перевіряє так само). */

/** Проста перевірка: щось@домен.зона, без пробілів. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
