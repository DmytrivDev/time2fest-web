# infra/ops — розгортання, відкат, секрети й потужність вузла

Нуль залежностей, звичайний Node ESM (`.mjs`, `// @ts-check`). Одна точка входу — `node infra/ops/ops.mjs <підкоманда> …`;
у корені робочого простору для кожної є скрипт `pnpm`. Порядок роботи будь-якої команди: **аргументи → запобіжник →
підкоманда**. Відмова аргументу чи запобіжника — код 2 до будь-якого виклику `ssh`, `docker` чи `wrangler`.

Усе тут стосується середовища репетиції (`rehearsal`) і Worker’а `prelaunch`/`production`. Старий продакшн-сервер
(`Old Project`) жодна команда не чіпає за жодних прапорців.

## Команди

| Скрипт `pnpm` | Що робить | Аргументи |
|---|---|---|
| `pnpm deploy:env -- --env <rehearsal\|prelaunch\|production>` | збірка образу → доставка на вузол → міграції → заміна контейнера → перевірка здоров’я → Worker | `[--target local\|<IPv4\|ім’я>] [--commit <sha>] [--confirm <env>] [--allow-main-domain] [--emergency] [--probe] [--secrets-file <шлях>]` |
| `pnpm rollback:env -- --env <…>` | повернути Worker, потім контейнер сервера на попередній образ | `[--target …] [--to <sha, 40 hex>] [--confirm <env>] [--allow-main-domain] [--emergency] [--probe] [--secrets-file <шлях>]` |
| `pnpm node:bootstrap -- --host <IPv4\|ім’я>` | підготувати новий вузол (лише `rehearsal`) | `[--secrets-file <шлях>]` |
| `pnpm edge:secret -- --env rehearsal` | згенерувати секрети репетиції або замінити секрет краю | рівно один із `--generate`, `--rotate`; `[--target local\|<хост>] [--probe] [--secrets-file <шлях>]` |
| `pnpm edge:move-domain -- --name <ім’я> --to <worker>` | перенести ім’я між двома Worker’ами | `[--confirm <env>] [--allow-main-domain] [--secrets-file <шлях>]` |
| `pnpm capacity -- --env <rehearsal\|production>` | потужність вузлів провайдера | дія: `plan`, `night --size <розмір>`, `back`, `off-season`, `realtime-create`, `realtime-delete`, `status`; `[--confirm <env>] [--allow-main-domain] [--probe] [--secrets-file <шлях>]` |

`pnpm infra:cf …` (тунель, DNS, правила, Access) описано окремо в `infra/cloudflare/README.md`.

Правила розбору: невідомий прапорець, повторений прапорець, зайвий аргумент, значення з керівними символами — код 2. Приймається
лише те, що є в таблиці. `--env` для `bootstrap` і `edge-secret` — лише `rehearsal`; для `capacity` — `rehearsal` чи
`production`; `move-domain` `--env` не приймає. `--to` у `rollback` — повний SHA (40 hex), у `move-domain` — ім’я Worker’а.

### Коди виходу

| Код | Значення |
|---|---|
| 0 | готово (або лише план, або «без змін») |
| 1 | крок не вдався; назва кроку надрукована, виконане теж |
| 2 | відмова запобіжника чи аргументу, нічого не змінено |

### Запобіжники

- **Робочий домен.** Середовище `prelaunch` чи `production`, а також імена `time2fest.com`, `www.time2fest.com`,
  `admin.time2fest.com` — лише з обома `--confirm <середовище>` і `--allow-main-domain` разом. Без будь-якого з них — код 2.
  Для `move-domain` підтвердження називає середовище робочого домену (`--confirm prelaunch|production`).
- **Заморозка.** `production` з 31.12 08:00 до 01.01 14:00 за UTC: розгортання й відкат лише з `--emergency`.
- **Заборонена ціль.** Адреса старого продакшн-сервера відхиляється завжди.
- **Чисте дерево.** Розгортання без закомічених змін; збірка — з `git archive <sha>`, не з робочої теки.
- **Диск.** На вузлі менше 5 ГБ вільного місця — відмова до доставки образу.
- **Замок вузла `deploy-<env>`.** Друге розгортання чи відкат того самого середовища відмовляє одразу, нічого не чекаючи
  й не змінюючи. Замок не переживає власника (обрив зв’язку його знімає).
- **Секрет краю.** Відкат до запису зі старішим поколінням секрету краю відмовляє з поясненням про заміну секрету.
- **Міграції.** `deploy` і `rollback` ніколи не запускають `down`. Нова міграція сумісна з кодом попереднього образу
  (правило скіла `migration-safety`); відкат міграцій не відкочує.

## Розгортання й відкат

Кроки `deploy` (кожен іде в журнал із позначкою `start` і `ok`/`failed`): `build` → `deliver` → `migrate` → `swap` →
`health` → `worker`. Якщо `health` не пройшла, контейнер повертається на попередній образ (`swap-back`) і розгортання
завершується кодом 1. Якщо `worker` не вдався, вузол уже новий, а запис має `result: worker-failed`. `prelaunch` — лише
крок `worker`. Розгортання не пише секретів Worker’а.

`rollback` без `--to` бере останнє успішне розгортання з журналу: спершу Worker на його `workerVersionBefore`, потім
контейнер сервера на його `imageBefore`, потім перевірка здоров’я. Міграцій не запускає, файлів змінних вузла не змінює.
Немає успішного попереднього розгортання чи його образу на вузлі — відмова без змін.

На вузлі лишаються три останні образи сервера; поточний і попередній не видаляються ніколи.

`--probe` щосекунди питає `GET /api/health` через край і записує простій (від першої невдалої проби до першої успішної
після неї) у запис журналу.

`--target` — IPv4 чи ім’я вузла (вхід від імені `deploy`) або `local`: тоді все йде на локальний Docker.

## Вузол: розкладка

На вузлі каталог `/srv/t2f/<env>/` (власник `deploy`, режим 700):

| Файл | Хто пише | Призначення |
|---|---|---|
| `compose.yml` | розгортання (з `git show <sha>:infra/ops/node/compose.yml`) | сервіси `postgres`, `redis`, `server`, `cloudflared`; жодного опублікованого порту |
| `current.env`, `next.env` | розгортання, відкат | SHA образу для підстановки в Compose: поточний і той, що розгортається |
| `server.env`, `postgres.env`, `cloudflared.env` | `edge-secret --generate`, замінa секрету | змінні вузла, режим 0600 |
| `journal.jsonl` | розгортання, відкат, заміна секрету | журнал розгортань |
| `deploy.lock` | замок | `flock` на вузлі |

Приклади з самими назвами змінних — `infra/ops/node/{server,postgres,cloudflared}.env.example`; їх перевіряє тест
`infra/ops/test/env-example.test.mjs`. `T2F_ENV`, `T2F_HOST`, `T2F_SERVER_PORT` і `T2F_COMMIT` у файлах вузла не пишуться:
їх задають Compose й образ.

Локальні оригінали файлів і службові файли — `infra/ops/.local/<env>/` (git-ignored). Для `--target local` — окремий
стан у `infra/ops/.local/node-local-<env>/` (замок, журнал, `compose.yml`, `current.env`, `next.env`, файли змінних).
Відбитки ключів вузлів — `infra/ops/.local/known_hosts` або файл зі змінної `T2F_KNOWN_HOSTS_FILE`.

### Журнал розгортань

JSON-рядки (`journal.jsonl`), по одному на подію. Запис розгортання чи відкату має поля: `at` (ISO UTC), `env`, `commit`,
`imageBefore`, `imageAfter`, `workerVersionBefore`, `workerVersionAfter`, `edgeSecretGeneration`, `result`, `failedStep`,
за потреби `downtimeSeconds`. `result`: `ok`, `failed`, `worker-failed`, `rolled-back`. Запис про заміну секрету краю —
`kind: edge-secret` з номером покоління. Запис, що містить значення секрету, **відхиляється**, а не маскується.
Пошкоджені рядки читання пропускає.

## Секрети репетиції

`pnpm edge:secret -- --env rehearsal --generate [--target <хост>|local]` створює `PAYLOAD_SECRET`, `T2F_EDGE_SECRET` і пароль
Postgres (кожен — 32 випадкові байти з системного генератора) і заповнює порожні значення файлів у
`infra/ops/.local/rehearsal/` (режим 0600). З `--target` усі три файли відправляються на вузол, а секрет краю —
у секрети Worker’а; значення передаються лише через stdin, ніколи через аргументи, вивід чи журнал. Токен тунелю
береться з `infra/cloudflare/.local/tunnel-<env>.env`.

`--rotate` міняє секрет краю без простою, у такому порядку:

1. сервер отримує новий секрет, а старий як `T2F_EDGE_SECRET_PREVIOUS`; перезапуск сервера, чекаємо здоров’я;
2. новий секрет — у Worker;
3. перевірка через край (`GET /api/health` → 200); збій — стоп із кодом 1, обидва значення працюють далі;
4. `T2F_EDGE_SECRET_PREVIOUS` прибрано, перезапуск; у журнал іде запис із поколінням +1.

Після заміни відкат до запису зі старішим поколінням відмовляє (код 2), доки не буде нового розгортання. Зміна
`PAYLOAD_SECRET` анулює ключі агентів SPEC-04.

### Змінні оточення й `--secrets-file`

`--secrets-file <шлях>` — файл `NAME=value`; його змінні лише доповнюють оточення (наявні не перекриваються). Назви
з `TOKEN`, `SECRET`, `PASSWORD`, `KEY` і перелік `SECRET_ENV_NAMES` (`infra/ops/lib/config.mjs`) маскуються в кожному рядку
виводу. Файл не друкується.

| Змінна | Навіщо |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `wrangler`: розгортання й відкат Worker’а, перенесення імені |
| `DIGITALOCEAN_TOKEN`, `T2F_DO_SSH_KEY`, `T2F_PROVIDER` (необов’язкова) | команда `capacity`; `T2F_DO_SSH_KEY` — відбиток або номер ключа власника в обліковому записі |
| `T2F_KNOWN_HOSTS_FILE` | файл відбитків ключів вузлів |
| `T2F_CATALOG_URL` | адреса каталогу для збірки сайту (за замовчуванням `https://<хост сайту середовища>`) |
| `T2F_EDGE_SECRET`, `T2F_EDGE_SECRET_PREVIOUS`, `PAYLOAD_SECRET`, `POSTGRES_PASSWORD`, `TUNNEL_TOKEN`, `T2F_R2_*` | значення секретів; живуть лише у файлах вузла, секретах Worker’а й `.local` |

Повна карта секретів і порядок введення — `docs/backend/secrets.md` (текст дає латка документації SPEC-13a).

## Токени

**`DIGITALOCEAN_TOKEN`** — власна роль (custom scopes), лише потрібне: `droplet:read`, `droplet:create`, `droplet:update`,
`droplet:delete`, `actions:read`, `sizes:read`, `regions:read`, `tag:read`, `tag:create`, `ssh_key:read`, `image:read`,
`vpc:read`. Той самий перелік — `TOKEN_SCOPES` в `infra/ops/lib/capacity/digitalocean/config.mjs`.

**`CLOUDFLARE_API_TOKEN`** (розгортання Worker’а й перенесення імені) — права на розгортання Worker’ів і прив’язку Custom Domain для акаунта й зони (точний перелік вкаже ведучий хвилі після живого прогону);
**`CLOUDFLARE_API_TOKEN_INFRA`** (`infra/cloudflare`) — перелік у `infra/cloudflare/README.md`, розділ «Дозволи токена».
Підсумкова таблиця прав — у `docs/backend/secrets.md`.

**Правило: агенти не бачать робочих значень.** Агентам дають лише тестові й репетиційні ключі через `--secrets-file` поза
git. Робочі (production) значення вводить власник сам; у README, журналі й виводі — лише назви змінних.

## Потужність (`capacity`)

Без `--confirm <env>` команда лише друкує план із ціною за годину кожного кроку, що створює чи збільшує ресурс.
Змінює ресурси тільки з `--confirm <env>` (і ще `--allow-main-domain` для `production`).

- `night --size <розмір>` / `back` / `off-season` — основний вузол: лише вертикальна зміна розміру (CPU і RAM, без диска),
  розміри — зі списку середовища в `config.mjs` адаптера. `off-season` також видаляє вузол realtime.
- `realtime-create` / `realtime-delete` — вузол realtime створюється з тегами й підготовкою, видаляється (не вимикається);
  Compose-профіль цього вузла — лише `cloudflared`. Другого екземпляра `server` команда не запускає.
- `status` показує розбіжність із станом «поза сезоном».
- Змінює лише ресурси з обома тегами `t2f-managed` і `t2f-env-<env>`; основний вузол має ще `t2f-role-main`.
- Помилка провайдера чи ліміт частоти — зупинка з переліком виконаного; повторний запуск не повторює виконане.
- Журнал потужності — окремий файл `infra/ops/.local/<env>/capacity.jsonl`.

## Перенесення імені між Worker’ами

```
pnpm edge:move-domain -- --name rehearsal.time2fest.com --to <worker> --secrets-file <шлях>
```

Це не-інтерактивний `wrangler deploy` цільового Worker’а з тим самим Custom Domain; ім’я «переїжджає» разом із розгортанням.
Зонд щосекунди питає `GET https://<ім’я>/` від 5 с до й 30 с після розгортання, міряє проміжок і записує, хто
відповів (заголовок `x-t2f-twin`). Журнал — `infra/ops/.local/rehearsal/edge.jsonl`. Явне від’єднання — лише запасний
шлях при конфлікті й лише для прив’язки, яку журнал записав як створену цією командою; робочі хости не від’єднуються ніколи.

## Локальний вузол і тести

- **Проєкт Compose — `t2f-node-<env>`** (для репетиції `t2f-node-rehearsal`); жодних портів хоста. Ніколи не запускати
  `docker compose -p t2f` чи будь-що з проєктом без суфікса: це не наш проєкт.
- Інтеграційні тести локального вузла (`infra/ops/test/node/`, конфігурація `infra/ops/vitest.node.config.mjs`) — важкі
  (збірка образу, близько 4 ГБ пам’яті), тож запускаються лише під виключним замком, по одному:

```
node server/scripts/lock.mjs --mode exclusive -- node node_modules/vitest/vitest.mjs run -c infra/ops/vitest.node.config.mjs infra/ops/test/node/deploy.int.test.mjs
```

  Те саме для `failure.int.test.mjs`. Тест прибирає лише свій проєкт, його образи й том `t2f-node-rehearsal_pgdata`.
- Швидкі тести пакета й перевірка типів — конфігурація `verify` пакета `ops` у `.claude/sdd-engineering.json`.
- Перевірка на секрети в репозиторії: `node scripts/check-secrets.mjs` (для нового файлу спершу `git add -N <файл>`).

## Порядок кроків на справжньому вузлі (етап S2)

Виконує сесія хвилі, коли власник надав вузол; докладно — «Stage 2 runbook» наприкінці `docs/plans/SPEC-13a-server-deploy.plan.md`.

1. Власник створює вузол DigitalOcean (теги `t2f-managed`, `t2f-env-rehearsal`, `t2f-role-main`, його ключ SSH), кладе ключі R2
   і значення Access у `infra/ops/.local/rehearsal/server.env`.
2. `pnpm node:bootstrap -- --host <ip>`; відбиток ключа вузла, що надрукувала команда, **звірити з консоллю провайдера**.
3. `pnpm infra:cf apply --env rehearsal --secrets-file <файл>` (тунель, імена; токен тунелю пишеться в `.local`).
4. `pnpm edge:secret -- --env rehearsal --generate --target <ip> --secrets-file <файл>`.
5. `pnpm deploy:env -- --env rehearsal --target <ip> --probe --secrets-file <файл>`.
6. `pnpm edge:secret -- --env rehearsal --rotate --target <ip> --probe --secrets-file <файл>`.

`bootstrap` ідемпотентний: повторний запуск друкує «без змін». Він створює користувача `deploy` з ключем власника, ставить
Docker, створює каталог вузла, закриває брандмауер усім, крім TCP 22, і вимикає вхід root і паролі в SSH (лише після того,
як вхід `deploy` перевірено). Якщо в брандмауері вже є зайві правила, перевірка не пройде (код 1).

## Розгортання з GitHub Actions

`.github/workflows/deploy.yml` — лише ручний запуск (`workflow_dispatch`) із входом `env` (єдине значення — `rehearsal`),
дії закріплені за SHA, секрети — лише за назвами через `env:`: `T2F_REHEARSAL_SSH_KEY`, `T2F_REHEARSAL_KNOWN_HOSTS`,
`T2F_REHEARSAL_HOST`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Викликає ту саму `pnpm deploy:env`.
Ключ розгортання — окрема пара SSH лише для користувача `deploy` вузла репетиції.
