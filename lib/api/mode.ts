/**
 * Один перемикач шва (`docs/backend/frontend-seam.md`): `NEXT_PUBLIC_API_MODE=sim|http`.
 * - `sim` (зараз за замовчуванням) — сервіси обгортають імітатори прототипу (`lib/api/sim/*`);
 * - `http` — справжній бекенд (`lib/api/http/*`, пишеться разом із бекендом).
 * Значення вбудовується під час збирання (як `NEXT_PUBLIC_ENV`), тож вибір сталий для всієї збірки.
 * Коли бекенд буде готовий, робоча збірка мусить бути `http`: див. «Заглушки → справжні сервіси» в документі.
 */
export type ApiMode = 'sim' | 'http';

export function parseApiMode(raw: string | undefined): ApiMode {
  return raw === 'http' ? 'http' : 'sim';
}

export const API_MODE: ApiMode = parseApiMode(process.env.NEXT_PUBLIC_API_MODE);
