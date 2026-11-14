# Time2Fest — сайт (`web/`)

Next.js 16 (App Router, статичний експорт), TypeScript, next-intl, Tailwind + CSS-модулі, zustand. Дані — через шов з бекендом `lib/api` (зараз адаптери `sim`, імітація в браузері).

## Запуск

Потрібні Node ≥ 22.12 і pnpm.

| Команда | Що |
|---|---|
| `pnpm install` | Залежності |
| `pnpm dev:test` | Розробка: тестова збірка (машина часу `?t=…&speed=…`, тестова панель, імітації `sim`), http://localhost:3000 |
| `pnpm dev:demo` / `pnpm build:demo` | Демо для тесту на людях (тестова збірка + `NEXT_PUBLIC_DEMO=1`); статичний результат — `out-demo/` |
| `pnpm dev` / `pnpm build` | Робоча збірка (`http`): поки бекенду немає, показує «Сервер недоступний» |
| `pnpm typecheck`, `pnpm lint` | `tsc --noEmit`, `eslint .` (з правилами шва) |
| `pnpm test` | Юніт-тести (Vitest); на завантаженій машині — `pnpm test -- --maxWorkers=2` |
| `pnpm test:e2e` | E2E (Playwright: `phone`, `desktop`, `tv`; `prod` — робоча збірка на порту 3100) |
| `pnpm storybook` | Storybook, порт 6006 |

Матриця збірок і режимів даних — `docs/backend/frontend-seam.md`, §2.3.

## Де що лежить

Коротко: `app/` — маршрути; `components/<домен>/` — інтерфейс за сторінками й доменами (`primitives/` — спільні дрібні елементи, `live/` — спільні блоки ефіру); `lib/` — чиста логіка й шов `lib/api` (компоненти беруть дані лише з `@/lib/api/hooks/*`); `stores/` — стан клієнта; `messages/uk.json` — тексти.

Повна карта тек, з чого почати читати кожну сторінку і як додати сторінку, домен сервісу чи стан — `docs/site/00-overview.md`, розділ 8. Опис кожної сторінки — `docs/site/<сторінка>.md`; шов з бекендом — `docs/backend/frontend-seam.md`.
