/**
 * Один перемикач шва (`docs/backend/frontend-seam.md`, §2.3): `NEXT_PUBLIC_API_MODE=sim|http`.
 * - `sim` — сервіси обгортають імітатори прототипу (`lib/api/sim/*`);
 * - `http` — справжній бекенд (`lib/api/http/*`, пишеться разом із бекендом).
 * Ефективний режим вирішує `resolveApiMode` у `next.config.ts` під час збирання і вбудовує його як літерал, тож вибір
 * сталий для всієї збірки, а в збірці `http` імітація вирізається з пакета (`simEntry` підміняється). Тут, у рантаймі,
 * лише читаємо вбудоване значення; без нього (vitest, Storybook) — `sim`.
 *
 * Без імпортів: файл читає й `next.config.ts`.
 */
export type ApiMode = 'sim' | 'http';

export function parseApiMode(raw: string | undefined): ApiMode {
  return raw === 'http' ? 'http' : 'sim';
}

export interface ApiModeInput {
  /** `NEXT_PUBLIC_API_MODE` як задано (може бути порожнім). */
  raw: string | undefined;
  /** Тестова чи демо-збірка (`NEXT_PUBLIC_ENV=test`, демо — те саме плюс `NEXT_PUBLIC_DEMO=1`). */
  testBuild: boolean;
  /** Робоче збирання (`next build`), а не `next dev`. */
  productionBuild: boolean;
}

/**
 * Правило запобіжника:
 * - задано `http` чи `sim` — так і буде, але `sim` у робочому збиранні без тестового прапорця — помилка (імітований чат,
 *   вхід, оплати, оцінки й тости не можуть потрапити на `time2fest.com`);
 * - не задано: тестова й демо-збірка — `sim` (як завжди), будь-яка інша — `http`.
 */
export function resolveApiMode({ raw, testBuild, productionBuild }: ApiModeInput): ApiMode {
  const mode: ApiMode = raw === 'http' || raw === 'sim' ? raw : testBuild ? 'sim' : 'http';
  if (raw !== undefined && raw !== '' && raw !== 'http' && raw !== 'sim') {
    throw new Error(`[api] NEXT_PUBLIC_API_MODE=${raw}: дозволено лише sim або http`);
  }
  if (mode === 'sim' && productionBuild && !testBuild) {
    throw new Error(
      '[api] Робоча збірка з імітацією заборонена: NEXT_PUBLIC_API_MODE=sim без NEXT_PUBLIC_ENV=test. ' +
        'Для демо — pnpm build:demo; для робочої — NEXT_PUBLIC_API_MODE=http (або не задавати).',
    );
  }
  return mode;
}

export const API_MODE: ApiMode = parseApiMode(process.env.NEXT_PUBLIC_API_MODE);
