# Spec: Репозиторій і словник шва
Spec ID: SPEC-01
Status: approved
Supersedes: none

## Problem and user

Хвилі бекенду (етап 0, трек A) підуть паралельно, кожна у своєму дереві git. Сьогодні в `web/` немає місця для спільного пакета контрактів і сервера (FR-PLAT-01, `specs/002-backend/spec.md:485`), немає домену `site` (`docs/backend/frontend-seam.md:242`), а причини відмов, види системних повідомлень і нові поля з `spec.md` §8.3 (`spec.md:1067-1083`) ще не записані в контракти. Якщо кожна хвиля дописуватиме ці переліки сама, вони конфліктуватимуть у тих самих файлах, а відкриті вкладки зі старим клієнтом можуть зламатися від неадитивної зміни (FR-MIG-07, `spec.md:933`). Немає й CI: зламаний `master` видно лише локально (`.github/` відсутній). Користувачі цієї специфікації — оркестратор і агенти наступних хвиль; власник — лише як той, хто має не побачити жодної зміни на сайті й у демо.

## Goals / Non-goals

**Goals**
- Робочий простір pnpm у `web/`: `time2fest-web`, `@time2fest/contracts`, `@time2fest/rules` (теки `time/`, `text/` — порожні каркаси).
- `@time2fest/contracts` містить спільну модель помилок (`ApiResult`/`ApiError`) і новий домен `site`; `lib/api/*` їх реекспортує — шляхи імпорту на сайті не змінюються (рішення оркестратора за питанням 1(а)).
- Повний словник шва за §8.3 пп. 2–9: нові причини, види системних повідомлень, необов’язкові поля, стан «повернено».
- Домен `site`: контракт, адаптер `sim` з типовими значеннями, хук без споживачів (§8.3 п. 1).
- Перевірка «контракт лише додаванням» у `verify`.
- GitHub Actions: `verify` на кожен пуш у будь-яку гілку (відповідь власника 3(а)).
- Справжні команди `verify` для `contracts` і `rules` у `.claude/sdd-engineering.json`.
- Латка документації для `frontend-seam.md` §3.11 — у звіті хвилі (§8.3 п. 10).

**Non-goals**
- Будь-який код у `server/`, бекенд, Docker — інші хвилі.
- Перенесення решти контрактів (`lib/api/contracts/*`) у пакет — кожна доменна хвиля переносить свій, коли будує `http` (питання 1(а)).
- Будь-яка видима зміна сайту; читання `site` компонентами, поправка моменту у відліку, перемикачі в інтерфейсі, ціни з `site.products` (§8.3 пп. 1, 12) — хвилі, що вперше читають `site`.
- Стан «утримано» в `ChatMessage.moderation` — видимий (`components/chat/Chat.tsx:104` фільтрує лише `hidden`), лишається SPEC-16.
- `refunded` як кінцевий стан і його показ у смузі повернення (`components/checkout/ReturnNotice.tsx:61-71`) — хвиля оплат.
- Вигляд нових системних повідомлень у чаті — хвиля чату (зараз невідомий вид падає на `message.text`, `components/chat/parts/Message.tsx:273-335`, а `sim` таких не створює).
- Поведінкові зміни §8.3: `chains()` без параметрів і стан «пробувати джерело» (п. 2), правило `room-forbidden`, `compareMessages`, `translate` без `text`/`from`, коди `react`/`remove`/`report` (п. 3), зміна зняття штампа і відповіді `sim` у паспорті (п. 5), `list({ since })` тостів (п. 6), `forbidden` графіка й повторне підтвердження `deleteAccount` (п. 8), скелети (п. 11), юридичні тексти (п. 13) — доменні хвилі.
- Закріплення версії pnpm (`packageManager` + `ENABLE_EXPERIMENTAL_COREPACK`) — відповідь власника 2(а): у Vercel нічого не змінюємо.
- Пробна збірка Vercel через пуш гілки — пропозицію 1 відхилено (пушити в цій хвилі заборонено); замість неї — локальна перевірка трьома версіями pnpm (AC-3).
- e2e у CI — відповідь 3(а).
- Типове значення листів-нагадувань — хвиля профілю (Open question 3).

## User stories

- **US-1** Як агент наступної хвилі, я хочу робочий простір pnpm з пакетами `contracts` і `rules`, щоб сервер і сайт ділили один опис дроту (FR-PLAT-01). → AC-1, AC-2, AC-5, AC-6
- **US-2** Як агент доменної хвилі, я хочу знайти всі нові причини, види й поля вже в контрактах, щоб не правити спільні переліки одночасно з іншими хвилями. → AC-16 … AC-30
- **US-3** Як агент хвилі `site`, я хочу готовий контракт, адаптер `sim` і хук домену `site`, щоб будувати лише `http` і поведінку. → AC-7 … AC-15
- **US-4** Як власник, я хочу, щоб сайт і демо виглядали й працювали точно як зараз. → AC-31, AC-32, AC-33
- **US-5** Як власник, я хочу, щоб демо на Vercel збиралося тією самою командою встановлення без моїх дій у панелі Vercel. → AC-3, AC-4
- **US-6** Як оркестратор, я хочу, щоб GitHub Actions перевіряв кожен пуш. → AC-34 … AC-37
- **US-7** Як власник відкритих вкладок у ніч свята (FR-MIG-07), я хочу, щоб контракт змінювався лише додаванням, а ламаюча зміна була явною. → AC-38 … AC-42
- **US-8** Як конвеєр `sdd-engineering`, я хочу справжні команди `verify` для нових пакетів і латку §3.11 у звіті. → AC-43 … AC-46

## Acceptance criteria (EARS)

### Робочий простір

**AC-1 [web, contracts, rules]** The workspace shall consist of exactly three projects: `time2fest-web`, `@time2fest/contracts`, `@time2fest/rules`.
Verify: integration — `pnpm -r ls --depth -1` у чистому дереві перелічує рівно ці три назви.

**AC-2 [rules]** The `@time2fest/rules` package shall contain the folders `time/` and `text/` with no exported runtime behaviour, passing its own typecheck.
Verify: unit — typecheck пакета проходить; модулі `time/` і `text/` не експортують жодної функції чи значення.

**AC-3 [web]** WHEN `pnpm install --frozen-lockfile` and then `pnpm build:demo` run in a clean worktree with pnpm 9.x, pnpm 10.x and the local pnpm 12.x, the system shall finish both commands with exit code 0 and produce `out-demo/index.html` for each of the three versions.
Verify: manual — три прогони (`npx pnpm@9`, `npx pnpm@10`, локальний) з виводом у звіті виконавця; у CI різних версій pnpm немає, а пушити для пробної збірки Vercel заборонено (відповідь власника 2(а)).

**AC-4 [web]** The system shall keep `vercel.json` byte-identical to `master` (`installCommand` `pnpm install --frozen-lockfile`, `buildCommand` `pnpm build:demo`, `outputDirectory` `out-demo`).
Verify: unit (static) — `git diff master -- vercel.json` порожній.

### Пакет контрактів

**AC-5 [contracts]** The `@time2fest/contracts` package shall export `ApiErrorCode`, `ApiError`, `ApiResult`, `Unsubscribe`, `ok`, `fail` with the same members and semantics as `lib/api/result.ts:8-48` today, and the `site` contract (AC-7, AC-8).
Verify: unit — тест пакета: `ok`/`fail` дають ті самі об’єкти, що й сьогодні; перелік кодів `ApiErrorCode` збігається.

**AC-6 [web]** The system shall keep every existing import of `@/lib/api/result` and `@/lib/api/contracts/*` working through re-exports, with zero import lines changed outside the wave's file list.
Verify: unit (static) — `tsc --noEmit -p .` проходить; `git diff master --name-only` не містить файлів поза списком хвилі, крім дозволеного `lib/data/types.ts`.

### Домен `site`

**AC-7 [contracts]** The `site` contract shall define `SiteState` with exactly the fields of FR-SITE-01 (`spec.md:620`): `version`, `at`, `switches` (`chat`, `chatRooms`, `toasts`, `toastTiers`, `pass`, `passGift`, `payments`, `viewersMap`, `passOffer`), `products` (each with a stable key `pass` | `toast:2` | `toast:5` | `toast:10`, price in minor units, currency, `priceVersion`), `catalogVersion`, and `eventPatches` keyed by event id (corrected moment, `isMainCelebration`, `restrained` with an optional note, `hidden`), and no `announcements` or `minBuild` field.
Verify: unit — типовий тест: об’єкт з усіма полями компілюється; об’єкт з `announcements` чи `minBuild` — ні.

**AC-8 [contracts]** WHEN `applySiteEvent` receives a snapshot whose `version` is lower than or equal to the current state's `version`, the system shall return the current state unchanged (the same reference).
Verify: unit — старіший і рівний знімки повертають той самий об’єкт (FR-SITE-03).

**AC-9 [contracts]** WHEN `applySiteEvent` receives a snapshot whose `version` is higher than the current state's `version`, or there is no current state, the system shall return the received snapshot.
Verify: unit — новіший знімок замінює поточний.

**AC-10 [web]** WHEN `state()` of the `sim` adapter is called, the system shall return `ok` with: every switch on and no chat room closed, every toast tier on; products `pass` 500, `toast:2` 200, `toast:5` 500, `toast:10` 1000 in `USD` minor units with one shared `priceVersion`; no event patches; `catalogVersion` equal to `catalog.version()` (`lib/api/contracts/catalog.ts:16`).
Verify: unit — тест адаптера `sim` порівнює відповідь з цими значеннями.

**AC-11 [web]** WHEN `peek()` of the `site` service is called, the system shall return the last state delivered by `state()` or `subscribe`, or `undefined` before the first delivery.
Verify: unit — `peek()` до і після `state()`.

**AC-12 [web]** WHILE `state()` is pending in the `site` hook, the system shall apply every snapshot received through `subscribe` after the load through `applySiteEvent`, so that the hook exposes the highest version seen.
Verify: unit — подія з вищою версією під час завантаження перемагає відповідь `state()`; з нижчою — ні (FR-SITE-03).

**AC-13 [web]** WHEN `getService('site')` is called in `sim` mode, the system shall return the `site` service wrapped like the other `sim` services.
Verify: unit — сервіс повертається, а затримки й відмови тестової панелі (`withFaults`) діють і на нього.

**AC-14 [web]** The system shall keep `MIGRATED_DOMAINS` and the result of `missingDomains('http')` equal to `master` (`site` not added).
Verify: unit — наявний `tests/unit/api/mode.test.tsx` проходить без змін.

**AC-15 [web]** The system shall not import the `site` hook or service from any module under `components/`, `app/` or `stores/`.
Verify: unit (static) — пошук імпортів `hooks/site` і `getService('site')` поза `lib/api/**` і `tests/**` порожній.

### Словник шва: причини

**AC-16 [web]** The chat contract shall export the send reason `chat-closed` (code `unavailable`, `spec.md:716`) and the translate reason `translate-limit` (code `rate_limited`, `spec.md:744`) as literal union members next to the existing `ChatSendReason` (`lib/api/contracts/chat.ts:15`).
Verify: unit — типовий тест: обидва літерали належать експортованим об’єднанням.

**AC-17 [web]** The checkout contract shall export a literal union of `start` reasons that contains the existing `pass-owned` and `payments-off` (`unavailable`), `banned` (`forbidden`), `price-changed` (`conflict`), `toasts-closed` (`conflict`), `tier-off` (`conflict`), `countries` (`validation`), each documented with its code (`spec.md:124,659,780,805`).
Verify: unit — типовий тест на кожен літерал.

**AC-18 [web]** The checkout contract shall export the `cancel` reason `already-paid` with code `conflict` (`spec.md:779`).
Verify: unit — типовий тест.

**AC-19 [web]** The passport contract shall export the `claim` reasons `claim-closed` (`conflict`) and `unknown-event` (`not_found`) (`spec.md:757`).
Verify: unit — типовий тест.

**AC-20 [web]** The toasts contract shall export the `check` reason `moderation` with code `validation` (`spec.md:781`).
Verify: unit — типовий тест.

**AC-21 [web]** The profile contract shall export the `linkGoogle` reason `google-taken` with code `conflict` (`spec.md:660`).
Verify: unit — типовий тест.

**AC-22 [web]** The rating contract shall export the `vote` reason `not-rated` with code `forbidden` (`spec.md:821`).
Verify: unit — типовий тест.

### Словник шва: види й поля

**AC-23 [web]** The `SystemPayload` union (`lib/data/types.ts:184-195`) shall gain exactly two members: `{ kind: 'announcement'; text: string }` and the time-to-be-confirmed member `{ kind: 'time-pending'; eventId: string }`.
Verify: unit — типовий тест: обидва члени компілюються; наявні шість видів не змінено.

**AC-24 [web]** The checkout contract shall gain the optional fields `priceVersion` in `CheckoutStartRequest`, and `price` (minor units and currency) and `priceVersion` in `Order`.
Verify: unit — типовий тест: старі об’єкти без полів і нові з полями компілюються.

**AC-25 [web]** The `isFinalOrder` function shall return `false` for the new `OrderStatus` member `refunded` and the same values as today for the other six members.
Verify: unit — `isFinalOrder` для всіх семи станів; для `refunded` — `false`, для решти — як сьогодні.

**AC-26 [web]** The auth contract `Session` shall gain an optional field naming the celebration the pass is for (FR-ID-15, `spec.md:657`).
Verify: unit — типовий тест.

**AC-27 [web]** The profile contract `ProfileSettings` shall gain an optional boolean for reminder emails (FR-PROF-11, `spec.md:674`).
Verify: unit — типовий тест; `sim` профілю поле не повертає.

**AC-28 [web]** WHEN `applyStreamEvent` receives the new `{ type: 'hide'; eventId; sourceId }` event, the system shall return the same map reference.
Verify: unit — подія `hide` не змінює мапу ланцюжків.

**AC-29 [web]** The live types shall gain an optional `version` on every `StreamEvent` member and on `StreamChain`, and an optional `override` flag on `StreamSource`.
Verify: unit — типовий тест; наявні тести `live` проходять без змін.

**AC-30 [web]** The `sim` adapters shall emit none of the new reasons, kinds, statuses or fields of AC-16 … AC-29.
Verify: unit — наявні тести `tests/unit/api/*-sim.test.ts` проходять без змін; пошук нових літералів у `lib/api/sim/**` (крім `site*`) порожній.

### Без видимих змін

**AC-31 [web]** The system shall leave every file under `components/`, `app/`, `styles/`, `messages/`, `lib/engine/` unchanged, and change files under `stores/` only in type positions.
Verify: unit (static) — `git diff master --name-only` не містить перших п’яти тек; зміни в `stores/` (якщо є) — лише типи.

**AC-32 [web]** The e2e suite shall pass with no file under `tests/e2e/` changed.
Verify: e2e — `playwright test --workers=2` зелений; `git diff master -- tests/e2e` порожній.

**AC-33 [web]** The reference-board capture of the `sim` build shall report 0 boards above the 0.1 % difference threshold.
Verify: e2e — прогін зйомки й порівняння дошок за скілом `layout-fidelity` (`sim`-збірка).

### CI

**AC-34 [web]** WHEN a commit is pushed to any branch, the GitHub Actions workflow shall run `pnpm install --frozen-lockfile` and then the `full` verify commands of `web`, `contracts` and `rules` on `ubuntu-latest` with Node 22.
Verify: manual — пушити в цій хвилі заборонено; перевіряє оркестратор на першому пуші після злиття (запуск видно в Actions). До того — огляд файлу workflow: тригер `push` без фільтра гілок.

**AC-35 [web]** WHEN a new push arrives on a branch while a run for the same branch is in progress, the workflow shall cancel the older run.
Verify: manual — `concurrency` з `cancel-in-progress: true`, групою за гілкою; спостерігається на двох пушах поспіль після злиття.

**AC-36 [web]** IF the frozen install fails or any verify command exits non-zero, THEN the workflow job shall finish with status failed.
Verify: manual — перший червоний запуск після злиття, або огляд: кроки без `continue-on-error`.

**AC-37 [web]** The workflow shall not run Playwright, Storybook tests or any e2e command.
Verify: unit (static) — у файлі workflow немає `playwright`, `test:e2e`, `storybook`.

### Контракт лише додаванням

**AC-38 [web, contracts]** IF a change removes an exported declaration, a property or a union member, or turns an optional property into a required one, in the covered surfaces (`packages/contracts`, `lib/api/contracts`, and every `lib/data/types.ts` declaration reachable from their exports), THEN the additive check shall exit non-zero and name each such declaration.
Verify: unit — фікстури: вилучене поле, вилучений член об’єднання, поле з `?` стало обов’язковим — кожна дає ненульовий код і назву.

**AC-39 [web, contracts]** WHEN a change only adds exports, optional properties or union members to the covered surfaces, the additive check shall exit 0.
Verify: unit — фікстура з новим необов’язковим полем і новою причиною проходить.

**AC-40 [web, contracts]** IF the committed baseline of the covered surfaces does not match the current surfaces after a purely additive change, THEN the additive check shall fail and print the command that refreshes the baseline.
Verify: unit — фікстура з незаписаним доданням дає відмову з командою оновлення.

**AC-41 [web, contracts]** WHERE a breaking change is intended, the additive check shall pass only after the baseline is regenerated with an explicit breaking flag that records the removed or narrowed declarations in the baseline.
Verify: unit — без прапорця ламаюча фікстура падає; з прапорцем — проходить, і запис про ламаючу зміну є в базовому знімку.

**AC-42 [web, contracts]** The additive check shall be part of the `full` verify of `web` and of `contracts`.
Verify: unit (static) — обидва рядки `full` у `.claude/sdd-engineering.json` викликають перевірку.

### Конвеєр і документація

**AC-43 [contracts]** The `contracts` entry of `.claude/sdd-engineering.json` shall hold real `files` and `full` commands (typecheck, tests with `--maxWorkers=2`, additive check) that exit 0 on the clean tree.
Verify: integration — обидві команди запущено в `packages/contracts`, код 0.

**AC-44 [rules]** The configuration shall gain a `rules` entry whose `files` and `full` commands run the package typecheck and exit 0 on the clean tree.
Verify: integration — обидві команди запущено в `packages/rules`, код 0.

**AC-45 [web]** The system shall keep the `server` entry of `.claude/sdd-engineering.json` equal to `master`.
Verify: unit (static) — запис `server` не змінено.

**AC-46 [web]** The wave report shall contain a docs patch for `docs/backend/frontend-seam.md` §3.11 that adds the `site` row (`GET /api/site/state`, `site:state`) and the eight routes listed at `frontend-seam.md:242-249`, while no file outside `web/` is edited.
Verify: manual — огляд латки оркестратором (документи кореня правлять лише в головній сесії).

## Edge cases

- **EC-1** pnpm 9 чи 10 на Vercel не приймає lockfile, переписаний локальним pnpm 12. → AC-3
- **EC-2** `allowBuilds` (`pnpm-workspace.yaml:1-9`) — налаштування pnpm 11+; pnpm 9 запускає всі скрипти збирання, 10 — пропускає неперелічені; встановлення не падає, але збірка мусить пройти. → AC-3
- **EC-3** pnpm 9 відкидає `pnpm-workspace.yaml` без поля `packages`. → AC-1, AC-3
- **EC-4** Замовлення `refunded` потрапляє на смугу повернення. → AC-25 (не кінцеве — смуга не отримує невідомого виду); показ — Non-goal
- **EC-5** Подія `hide` приходить до хвилі `live`. → AC-28
- **EC-6** Знімок `state()` старіший за подію, що прийшла під час завантаження. → AC-8, AC-12
- **EC-7** Знімок тієї самої версії приходить двічі. → AC-8
- **EC-8** `getService('site')` у режимі `http`: фабрики немає — та сама помилка «ще не перенесено», що й для інших доменів, а банер `ApiGuard` не змінюється. → AC-14
- **EC-9** Сервер пізніше надсилає невідомий клієнту вид системного повідомлення. → Non-goal (вигляд — хвиля чату); `sim` їх не створює → AC-30
- **EC-10** Ціна рівня тосту відрізняється від числа в назві рівня (FR-SITE-05). → AC-7 (ключ товару не залежить від ціни)
- **EC-11** Джерела токенів дизайну немає в CI (корінь Time2Fest не в git). → AC-34 (`scripts/sync_tokens.mjs:16-19` пропускає перевірку)
- **EC-12** Два пуші в ту саму гілку поспіль. → AC-35
- **EC-13** Пізніша UI-правка `lib/data/types.ts` вилучає тип, досяжний з контрактів. → AC-38, AC-41
- **EC-14** Фактична версія pnpm на Vercel невідома. → Open question 1
- **EC-15** На приватному репозиторії закінчуються безплатні хвилини CI. → Open question 2

## Non-functional requirements

**NFR-1 [web]** The `dependencies` of `time2fest-web` shall gain no third-party package; only the two workspace packages may be added.
Verify: unit (static) — порівняння `dependencies` з `master`.

**NFR-2 [web]** The production (`http`) build shall contain no `sim` code of the `site` domain.
Verify: integration — наявний запобіжник бандла `http` (`frontend-seam.md` §4) проходить з доданим `site`.

**NFR-3 [contracts, rules]** The packages shall import nothing from the web app (`@/…` paths or relative paths out of `packages/`).
Verify: unit (static) — пошук `from '@/` і `../../` у `packages/**` порожній.

**NFR-4 [web]** The workflow shall request only `contents: read` permission and reference no repository secret.
Verify: unit (static) — у workflow є `permissions: contents: read` і немає `secrets.`.

**NFR-5 [contracts, rules]** Every test command of the packages shall run with at most 2 workers.
Verify: unit (static) — команди в `.claude/sdd-engineering.json` і скриптах пакетів містять `--maxWorkers=2` (`docs/backend/sdd-routing.md` §7).

## Module interactions

Під час роботи сайту ця хвиля не перетинає жодної межі: адаптер `sim` повертає локальні значення, `http`-фабрики для `site` немає (AC-14). Діаграма не потрібна (одна майбутня межа, стани знімка — «є/немає»).

Межі збирання й CI:
- **GitHub → GitHub Actions** (асинхронно, на пуш): встановлення з `--frozen-lockfile` і `verify`; збій → червоний запуск (AC-34, AC-36).
- **GitHub → Vercel** (асинхронно, на пуш у `master`): та сама команда встановлення, що й сьогодні (AC-4); збій → демо лишається на попередній збірці; захист — AC-3.

Контракт домену `site` — **proposed** (сервер з’явиться в хвилі `site`; тут — лише форма, на яку покладаються обидві сторони):

```text
GET /api/site/state                       (proposed; кеш на краю)
  200 → SiteState
    version: number (обов'язкове, зростає з кожною зміною)
    at: ISO-рядок (обов'язкове)
    catalogVersion: string (обов'язкове)
    switches (обов'язкове):
      chat, toasts, pass, passGift, payments, viewersMap, passOffer: boolean
      chatRooms: { [roomId]: boolean }   — відсутній ключ = кімната відкрита
      toastTiers: { "2" | "5" | "10": boolean }
    products (обов'язкове): масив
      key: "pass" | "toast:2" | "toast:5" | "toast:10"
      price: { amount: ціле, мінорні одиниці; currency: "USD" }
      priceVersion: number
    eventPatches (обов'язкове, може бути порожнім): { [eventId]:
      moment?: Ms, isMainCelebration?: boolean,
      restrained?: { note?: string }, hidden?: boolean }
  помилки: network | unavailable (клієнт лишає останній відомий знімок)

Канал Centrifugo site:state                (proposed)
  подія: { type: "snapshot"; state: SiteState }
  правило: applySiteEvent — новіша version перемагає (AC-8, AC-9)
```

## Inputs and provenance

| Вхід | Джерело | Хто виробляє | Свіжість | Довіра |
|---|---|---|---|---|
| Типові значення `site` у `sim` | константи адаптера `sim` | репозиторій | на збірку | довірений |
| `catalogVersion` у `sim` | `catalog.version()` (`lib/api/contracts/catalog.ts:16`) | дані збірки | на збірку | довірений |
| Пакети npm під час встановлення (локально, CI, Vercel) | реєстр npm | треті сторони | на встановлення | недовірений |
| Код гілки, що запускається в CI | пуш у GitHub | автор пушу | на пуш | недовірений щодо прав CI |
| `SiteState` з сервера | `GET /api/site/state` | майбутній сервер | ≤30 с (FR-SITE-02) | у цій хвилі не читається — Non-goal |

## Untrusted inputs

- **Пакети npm** — встановлення лише з зафіксованого lockfile з хешами цілісності (`--frozen-lockfile`): AC-3, AC-34; нових сторонніх залежностей сайту немає: NFR-1.
- **Код гілки в CI** — токен workflow лише на читання, секретів немає: NFR-4; e2e і сторонні інструменти не запускаються: AC-37.

## Design review

| # | Знахідка чи пропозиція (перший прохід) | Доказ | Рішення | Куди |
|---|---|---|---|---|
| 1 | Що лежить у `@time2fest/contracts` | `research-code.md` п. 9 | прийнято (а), оркестратор: модель помилок + `site`, реекспорт | AC-5, AC-6; Non-goal |
| 2 | Версія pnpm на Vercel | `research-vercel.md` рр. 3–5 | прийнято власником (а): у Vercel нічого не змінювати, довести локально | AC-3, AC-4; Open question 1 |
| 3 | Коли запускати CI | — | прийнято власником (а): кожен пуш, `cancel-in-progress`, без e2e, Node 22, `ubuntu-latest` | AC-34 … AC-37; Open question 2 |
| 4 | Додаткові правки `lib/data/types.ts` | `lib/data/types.ts:184-207` | прийнято (а), оркестратор: лише додавання, під перевіркою | AC-23, AC-29, AC-38 |
| 5 | Пропозиція: пробна збірка Vercel пушем гілки | — | відхилено (пушити заборонено) | Non-goal; AC-3 |
| 6 | `refunded` у `isFinalOrder` ламає смугу повернення | `lib/api/hooks/checkout.ts:65`, `ReturnNotice.tsx:61-71` | [А] прийнято: лише в об’єднанні, не кінцевий | AC-25; Non-goal |
| 7 | Подія `hide` не компілюється без правки `applyStreamEvent` | `lib/api/contracts/live.ts:56-66` | [А] прийнято: ігнорується | AC-28 |
| 8 | `version` у відповіді `chains()` ламає форму | `lib/api/contracts/live.ts:40` | [А] прийнято: у подіях і `StreamChain`, необов’язково | AC-29 |
| 9 | «Утримано» — видимий стан | `components/chat/Chat.tsx:104` | [А] прийнято: SPEC-16 | Non-goal |
| 10 | `site` у `MIGRATED_DOMAINS` | `lib/api/services.ts:41`, `lib/api/ApiGuard.tsx:14` | [А] прийнято: не додавати | AC-14 |
| 11 | Типові значення `sim` = сьогоднішній сайт | `lib/toast/tiers.ts:7`, `lib/offers/format.ts:5` | [А] прийнято | AC-10 |
| 12 | Стабільний ключ товару незалежно від ціни | FR-SITE-05 (`spec.md:624`) | [А] прийнято | AC-7 |
| 13 | `price-changed` без нової ціни — клієнт перечитує `site` | `spec.md:1074` | [А] прийнято | AC-17 |
| 14 | Причини — літеральні об’єднання з кодами за `spec.md` | `lib/api/result.ts:29` (відкритий `string`) | [А] прийнято | AC-16 … AC-22 |
| 15 | Мінімальна форма нових видів системних повідомлень | `spec.md:739` (FR-CHAT-26) | [А] прийнято | AC-23 |
| 16 | Межі перевірки «лише додаванням» і явний шлях ламаючої зміни | FR-MIG-07 | [А] прийнято | AC-38 … AC-42 |
| 17 | Пакети віддають TypeScript-джерела без кроку збирання; `rules` — власний запис `verify` (лише typecheck) | `.claude/sdd-engineering.json:11-16` | [А] прийнято; `rules` — уточнення оркестратора | AC-43, AC-44 |
| 18 | CI без джерела токенів дизайну | `scripts/sync_tokens.mjs:16-19` | [А] прийнято | AC-34, EC-11 |
| 19 | Латка §3.11 — у звіті, документи кореня не правити | `frontend-seam.md:221-249` | [А] прийнято | AC-46 |
| 20 | Подія каналу `site:state` — цілий знімок із `version`; дельти можна додати пізніше | `content-freshness.md:304-321` | рішення spec-creator у межах прийнятих [А]; оркестратор має підтвердити | AC-8, AC-9, AC-12 |

## Traceability

| AC / NFR | From (US / EC / design review) | Packages | Verify |
|---|---|---|---|
| AC-1 | US-1, EC-3 | web, contracts, rules | integration |
| AC-2 | US-1 | rules | unit |
| AC-3 | US-5, EC-1, EC-2, EC-3, DR-2, DR-5 | web | manual |
| AC-4 | US-5, DR-2 | web | unit |
| AC-5 | US-1, DR-1 | contracts | unit |
| AC-6 | US-1, DR-1 | web | unit |
| AC-7 | US-3, EC-10, DR-12 | contracts | unit |
| AC-8 | US-3, EC-6, EC-7, DR-20 | contracts | unit |
| AC-9 | US-3, DR-20 | contracts | unit |
| AC-10 | US-3, DR-11 | web | unit |
| AC-11 | US-3 | web | unit |
| AC-12 | US-3, EC-6, DR-20 | web | unit |
| AC-13 | US-3 | web | unit |
| AC-14 | US-3, EC-8, DR-10 | web | unit |
| AC-15 | US-3, US-4 | web | unit |
| AC-16 | US-2, DR-14 | web | unit |
| AC-17 | US-2, DR-13, DR-14 | web | unit |
| AC-18 | US-2, DR-14 | web | unit |
| AC-19 | US-2, DR-14 | web | unit |
| AC-20 | US-2, DR-14 | web | unit |
| AC-21 | US-2, DR-14 | web | unit |
| AC-22 | US-2, DR-14 | web | unit |
| AC-23 | US-2, DR-4, DR-15 | web | unit |
| AC-24 | US-2 | web | unit |
| AC-25 | US-2, EC-4, DR-6 | web | unit |
| AC-26 | US-2 | web | unit |
| AC-27 | US-2 | web | unit |
| AC-28 | US-2, EC-5, DR-7 | web | unit |
| AC-29 | US-2, DR-4, DR-8 | web | unit |
| AC-30 | US-2, US-4, EC-9 | web | unit |
| AC-31 | US-4 | web | unit |
| AC-32 | US-4 | web | e2e |
| AC-33 | US-4 | web | e2e |
| AC-34 | US-6, EC-11, DR-3, DR-18 | web | manual |
| AC-35 | US-6, EC-12, DR-3 | web | manual |
| AC-36 | US-6, DR-3 | web | manual |
| AC-37 | US-6, DR-3 | web | unit |
| AC-38 | US-7, EC-13, DR-4, DR-16 | web, contracts | unit |
| AC-39 | US-7, DR-16 | web, contracts | unit |
| AC-40 | US-7, DR-16 | web, contracts | unit |
| AC-41 | US-7, EC-13, DR-16 | web, contracts | unit |
| AC-42 | US-7, DR-16 | web, contracts | unit |
| AC-43 | US-8, DR-17 | contracts | integration |
| AC-44 | US-8, DR-17 | rules | integration |
| AC-45 | US-8 | web | unit |
| AC-46 | US-8, DR-19 | web | manual |
| NFR-1 | US-4, DR-1 | web | unit |
| NFR-2 | US-4 | web | integration |
| NFR-3 | US-1, DR-1 | contracts, rules | unit |
| NFR-4 | US-6 | web | unit |
| NFR-5 | US-8 | contracts, rules | unit |

(DR-N — рядок N таблиці Design review.)

## Open questions

Маркерів немає. Відкладені питання, що не блокують жодного критерію:

1. Яку версію pnpm фактично використовує Vercel (рядок «Using pnpm@…» у журналі збірки) — власник повідомить пізніше (відповідь 2(а)); AC-3 доводить сумісність з 9, 10 і 12 незалежно від відповіді. → EC-14
2. Тривалість одного запуску CI (репозиторій `DmytrivDev/time2fest-web` приватний — перевірено `gh repo view` 2026-11-16) — заміряти на першому запуску після злиття; якщо хвилин забракне, перейти на «`master` і pull request» (відповідь 3(а)). → EC-15
3. Типове значення листів-нагадувань для акаунта, що поля ще не має (приватність) — вирішує хвиля профілю; тут поле лише необов’язкове (AC-27).
