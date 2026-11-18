# infra/ops — розгортання, відкат, секрети й потужність вузла

Нуль залежностей, звичайний Node ESM (`.mjs`, `// @ts-check`). Одна точка входу — `node infra/ops/ops.mjs <підкоманда> …`;
у корені робочого простору для кожної є скрипт `pnpm`. Порядок роботи будь-якої команди: **аргументи → запобіжник →
підкоманда**. Відмова аргументу чи запобіжника — код 2 до будь-якого виклику `ssh`, `docker` чи `wrangler`.

Усе тут стосується середовища репетиції (`rehearsal`) і Worker’а `prelaunch`/`production`. Старий продакшн-сервер
(`Old Project`) жодна команда не чіпає за жодних прапорців.

## Команди

| Скрипт `pnpm` | Що робить | Аргументи |
|---|---|---|
| `pnpm deploy:env -- --env <rehearsal\|prelaunch\|production>` | збірка образу → доставка на вузол → міграції → заміна контейнера → перевірка здоров’я → Worker | `[--target local\|<IPv4\|ім’я>] [--commit <sha>] [--confirm <env>] [--allow-main-domain] [--take-domain-from <worker\|dns>] [--emergency] [--probe] [--secrets-file <шлях>]` |
| `pnpm rollback:env -- --env <…>` | повернути Worker, потім контейнер сервера на попередній образ | `[--target …] [--to <sha, 40 hex>] [--confirm <env>] [--allow-main-domain] [--emergency] [--probe] [--secrets-file <шлях>]` |
| `pnpm node:bootstrap -- --host <IPv4\|ім’я>` | підготувати новий вузол (лише `rehearsal`) | `[--secrets-file <шлях>]` |
| `pnpm edge:secret -- --env rehearsal` | згенерувати секрети репетиції або замінити секрет краю | рівно один із `--generate`, `--rotate`; `[--target local\|<хост>] [--probe] [--secrets-file <шлях>]` |
| `pnpm edge:move-domain -- --name <ім’я> --to <worker>` | перенести ім’я між двома Worker’ами | `[--confirm <env>] [--allow-main-domain] [--take-domain-from <worker\|dns>] [--emergency] [--secrets-file <шлях>]` |
| `pnpm capacity -- --env <rehearsal\|production>` | потужність вузлів провайдера | дія: `plan`, `night --size <розмір>`, `back`, `off-season`, `realtime-create`, `realtime-delete`, `status`, `server2-create [--size <розмір>]`, `server2-delete` (дві останні — лише `rehearsal`); `[--confirm <env>] [--allow-main-domain] [--emergency] [--probe] [--secrets-file <шлях>]` |
| `node infra/ops/ops.mjs private-db --env rehearsal --target <основний>` | тимчасовий доступ другого вузла до Postgres і Redis основного | дія: `open --peer <приватна IPv4>` або `close` |
| `node infra/ops/ops.mjs server2 --env rehearsal --target <основний>` | другий екземпляр сервера на тимчасовому вузлі | дія: `up` або `down`; `[--secrets-file <шлях>]` |
| `node infra/ops/ops.mjs scheduler-drill --env rehearsal --target <основний>` | навчання планувальника: зупинка власника оренди опівночі, замір перехоплення | `--mode one-node\|two-nodes`, `--midnight <ISO UTC північ поясу>`, `[--second <другий вузол>]` (лише `two-nodes`) |

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
  Для `move-domain` підтвердження називає середовище робочого домену (`--confirm prelaunch|production`); перенесення на
  робочий Worker — лише з `--confirm` саме його середовища, двійник (`t2f-edge-rehearsal-alt`) — лише для імені репетиції.
- **Тримач імені робочого домену.** Перед `wrangler deploy` середовища `prelaunch`/`production` (і так само
  `workers/edge/scripts/deploy.mjs`) читаються маршрути Worker’ів зони (`GET /zones/<z>/workers/routes`, один раз),
  прив’язки Custom Domain (`GET /accounts/<a>/workers/domains?hostname=`) і записи зони (`GET /zones/<z>/dns_records?name=`)
  кожного хоста маршрутів. Ім’я прив’язане до іншого Worker’а, покрите маршрутом іншого Worker’а чи має запис A/AAAA/CNAME
  не від Worker’а (старий сайт) — код 2, якщо `--take-domain-from <worker|dns>` не називає саме цього тримача (прапорець
  на вільному імені — теж код 2). Запис «Worker’а» (лише для читання, `AAAA 100::`) вважається Worker’овим лише разом із
  прив’язкою Custom Domain цього хоста; без неї його тримач — `dns`. Потрібні `CLOUDFLARE_ZONE_ID` і права токена на
  читання прив’язок, DNS і маршрутів зони; бракує — код 2 з назвою того, чого бракує (перевірка не пропускається).
  Однакову поведінку двох копій перевірки тримає `test/parity.test.mjs`. Репетиції й `test` не зачеплені.
- **Заморозка.** `production` з 31.12 08:00 до 01.01 14:00 за UTC: розгортання, відкат, `capacity --env production`
  (крім `plan` і `status`) і `move-domain` робочого домену — лише з `--emergency`.
- **Заборонена ціль.** Адреса старого продакшн-сервера відхиляється завжди — за адресою, а не написанням: до першого
  виклику SSH ціль (`--target`/`--host`, адреса вузла від провайдера в `capacity`) проходить `ssh -G` (псевдоніми
  `~/.ssh/config`) і DNS (усі адреси, зокрема IPv4 усередині IPv6); будь-яка адреса старого сервера, ім’я, що не
  резолвиться, чи збій `ssh -G` — код 2. Ім’я з міткою з самих цифр чи `0x…` (`0xb2149d55`, `178.20.157.85.nip.io`)
  не приймається взагалі. Сам `ssh` іде з `-F none` (налаштування користувача ціль не підмінять) і `CheckHostIP=yes`.
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
| `compose.yml` | розгортання (з `git show <sha>:infra/ops/node/compose.yml`) | сервіси `postgres`, `redis`, `server`, `cloudflared`; жодного опублікованого порту; мережі: `backend` (внутрішня) — лише `postgres`, `redis`, `server`; `tunnel` (внутрішня) — лише `server` і `cloudflared`; вихід назовні — `egress` (сервер) і `tunnel-egress` (`cloudflared`) |
| `current.env`, `next.env` | розгортання, відкат | SHA образу для підстановки в Compose: поточний і той, що розгортається |
| `server.env`, `postgres.env`, `redis.env`, `cloudflared.env`, `centrifugo.env` | `edge-secret --generate`, замінa секрету | змінні вузла, режим 0600; `redis.env` — `REDIS_PASSWORD` (Redis без пароля не стартує), той самий пароль — у `REDIS_URL` |
| `journal.jsonl` | розгортання, відкат, заміна секрету | журнал розгортань |
| `deploy.lock` | замок | `flock` на вузлі |

Приклади з самими назвами змінних — `infra/ops/node/{server,postgres,redis,cloudflared,centrifugo}.env.example`; їх перевіряє тест
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

`pnpm edge:secret -- --env rehearsal --generate [--target <хост>|local]` створює `PAYLOAD_SECRET`, `T2F_EDGE_SECRET`, паролі
Postgres і Redis (кожен — 32 випадкові байти з системного генератора) і заповнює порожні значення файлів у
`infra/ops/.local/rehearsal/` (режим 0600). З `--target` усі чотири файли відправляються на вузол, а секрет краю —
у секрети Worker’а; значення передаються лише через stdin, ніколи через аргументи, вивід чи журнал. Токен тунелю
береться з `infra/cloudflare/.local/tunnel-<env>.env`.

Вузол, розгорнутий до пароля Redis (`REDIS_URL` без пароля, `redis.env` немає): `--generate --target <хост>` створює
`REDIS_PASSWORD`, дописує його в наявний `REDIS_URL` (хост і база ті самі) і надсилає файли; наступний `deploy`
перестворює `redis` (лічильники обмеження частоти втрачаються — лише на репетиції), сервер і `cloudflared` (нові мережі).
Пароль у `REDIS_URL`, що не збігається з `REDIS_PASSWORD`, — відмова (код 2) без змін.

`--rotate` міняє секрет краю без простою, у такому порядку:

1. сервер отримує новий секрет, а старий як `T2F_EDGE_SECRET_PREVIOUS`; перезапуск сервера, чекаємо здоров’я;
2. новий секрет — у Worker;
3. перевірка через край (`GET /api/health` → 200); збій — стоп із кодом 1, обидва значення працюють далі;
4. `T2F_EDGE_SECRET_PREVIOUS` прибрано, перезапуск; у журнал іде запис із поколінням +1.

Після заміни відкат до запису зі старішим поколінням відмовляє (код 2), доки не буде нового розгортання. Зміна
`PAYLOAD_SECRET` анулює ключі агентів SPEC-04.

### Centrifugo на вузлі (SPEC-06 → SPEC-07, фаза 0)

Сервер у класі `rehearsal` не стартує без `T2F_CENTRIFUGO_URL`, `T2F_CENTRIFUGO_TOKEN_SECRET`, `T2F_CENTRIFUGO_API_KEY`.
`edge-secret --generate` дописує відсутні: URL `http://centrifugo:9000` (внутрішній порт API), два різні ключі (32 байти)
у `server.env` і ті самі значення в `centrifugo.env` (`CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`, `CENTRIFUGO_HTTP_API_KEY`)
плюс `CENTRIFUGO_ENGINE_REDIS_ADDRESS` (Redis вузла з паролем, база 1). Наявні значення не змінюються; розбіжність ключів
між двома файлами — відмова (код 2). Старіший вузол: `edge-secret --generate --target <ip>`, потім `deploy`.
Решта конфігурації — у `compose.yml` рядок у рядок з `pnpm --dir server realtime:config --print-env rehearsal` (звіряє
`test/compose.test.mjs`). `deploy` піднімає `postgres redis centrifugo` до здоров'я перед міграціями. Мережі: `backend`
(сервер → API 9000) і `realtime` (лише cloudflared → клієнтський порт 8000; ingress тунелю веде лише на 8000).
Ім'я `rt-rehearsal.time2fest.com` — `infra/cloudflare`; збірка сайту репетиції бере `NEXT_PUBLIC_REALTIME_URL` з `buildEnv`.

### Змінні оточення й `--secrets-file`

`--secrets-file <шлях>` — файл `NAME=value`; його змінні лише доповнюють оточення (наявні не перекриваються). Назви
з `TOKEN`, `SECRET`, `PASSWORD`, `KEY` і перелік `SECRET_ENV_NAMES` (`infra/ops/lib/config.mjs`) маскуються в кожному рядку
виводу. Файл не друкується. `deploy`, `rollback` і `capacity` так само маскують значення секретних змінних з локальних
оригіналів `infra/ops/.local/<env>/{server,postgres,redis,cloudflared,centrifugo}.env`, а пароль у будь-якому `схема://користувач:пароль@`
маскується завжди (рядок підключення в помилці міграції).

| Змінна | Навіщо |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `wrangler`: розгортання й відкат Worker’а, перенесення імені |
| `CLOUDFLARE_ZONE_ID` | зона `time2fest.com`: перевірка тримача імені перед розгортанням `prelaunch`/`production` (не секрет) |
| `DIGITALOCEAN_API_TOKEN`, `T2F_DO_SSH_KEY`, `T2F_PROVIDER` (необов’язкова) | команда `capacity`; `T2F_DO_SSH_KEY` — відбиток або номер ключа власника в обліковому записі |
| `T2F_KNOWN_HOSTS_FILE` | файл відбитків ключів вузлів |
| `T2F_CATALOG_URL` | адреса каталогу для збірки сайту (за замовчуванням `https://<хост сайту середовища>`) |
| `T2F_EDGE_SECRET`, `T2F_EDGE_SECRET_PREVIOUS`, `PAYLOAD_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `REDIS_URL`, `TUNNEL_TOKEN`, `T2F_R2_*` | значення секретів; живуть лише у файлах вузла, секретах Worker’а й `.local` |

Повна карта секретів і порядок введення — `docs/backend/secrets.md` (текст дає латка документації SPEC-13a).

## Токени

**`DIGITALOCEAN_API_TOKEN`** — власна роль (custom scopes), лише потрібне: `droplet:read`, `droplet:create`, `droplet:update`,
`droplet:delete`, `actions:read`, `sizes:read`, `regions:read`, `tag:read`, `tag:create`, `ssh_key:read`, `image:read`,
`vpc:read`. Той самий перелік — `TOKEN_SCOPES` в `infra/ops/lib/capacity/digitalocean/config.mjs`.

**`CLOUDFLARE_API_TOKEN`** (розгортання Worker’а й перенесення імені) — права на розгортання Worker’ів і прив’язку Custom Domain для акаунта й зони (розгортання репетиції, відкат і перенесення імені на двійника пройшли живими з токеном такого роду; мінімальний перелік по пунктах не вичищали — не перевірено); для `prelaunch`/`production` ще читання прив’язок Custom Domain (Account → Workers Scripts → Read), DNS зони (Zone → DNS → Read) і маршрутів Worker’ів зони (Zone → Workers Routes → Read) — без них розгортання й `move-domain` на Worker робочого домену відмовляють;
**`CLOUDFLARE_API_TOKEN_INFRA`** (`infra/cloudflare`) — перелік у `infra/cloudflare/README.md`, розділ «Дозволи токена».
Підсумкова таблиця прав — у `docs/backend/secrets.md`.

**Правило: агенти не бачать робочих значень.** Агентам дають лише тестові й репетиційні ключі через `--secrets-file` поза
git. Робочі (production) значення вводить власник сам; у README, журналі й виводі — лише назви змінних.

## Потужність (`capacity`)

Без `--confirm <env>` команда лише друкує план із ціною за годину кожного кроку, що створює чи збільшує ресурс.
Змінює ресурси тільки з `--confirm <env>` (і ще `--allow-main-domain` для `production`).

- `night --size <розмір>` / `back` / `off-season` — основний вузол: лише вертикальна зміна розміру (CPU і RAM, без диска),
  розміри — зі списку середовища в `config.mjs` адаптера. `off-season` також видаляє вузол realtime.
  Розміри DigitalOcean: `rehearsal` — поза сезоном `s-1vcpu-2gb` ($12/міс), дозволені `s-1vcpu-2gb`, `s-2vcpu-2gb`,
  `s-2vcpu-4gb`, `s-4vcpu-8gb` (диск лишається 50 GB); `production` — поза сезоном `s-2vcpu-4gb`, дозволені
  `s-1vcpu-2gb`, `s-2vcpu-2gb`, `s-2vcpu-4gb`, `s-4vcpu-8gb`, `s-8vcpu-16gb`.
- `realtime-create` / `realtime-delete` — вузол realtime створюється з тегами й підготовкою, видаляється (не вимикається);
  Compose-профіль цього вузла — лише `cloudflared`. Другого екземпляра `server` команда не запускає.
- `status` показує розбіжність із станом «поза сезоном».
- Змінює лише ресурси з обома тегами `t2f-managed` і `t2f-env-<env>`; основний вузол має ще `t2f-role-main`.
- Помилка провайдера чи ліміт частоти — зупинка з переліком виконаного; повторний запуск не повторює виконане.
- Журнал потужності — окремий файл `infra/ops/.local/<env>/capacity.jsonl`.
- `server2-create` / `server2-delete` — тимчасовий другий вузол сервера, лише `rehearsal` (див. наступний розділ).

## Другий вузол репетиції (навчання «два сервери»)

Рішення власника 2026-11-18 (O·P18a): навчання «два сервери» йде на двох вузлах — основному `t2f-main` (postgres, redis,
centrifugo, server, cloudflared) і **тимчасовому** другому, де працює лише другий контейнер `server`. Тунель і Worker
лишаються на основному; публічного входу на другий вузол немає. Оренда планувальника (рядок у Postgres) — одна на обидва.

**Межі згоди власника (не перевищувати):** один `s-1vcpu-2gb` у FRA1, роль — другий сервер, теги `t2f-managed` і
`t2f-env-rehearsal` (плюс тег ролі `t2f-role-server2`), **не довше 3 годин**, створити й **ВИДАЛИТИ** після навчання.

Що роблять команди:

- `capacity server2-create` — один вузол з тегами `t2f-managed`, `t2f-env-rehearsal`, `t2f-role-server2`, у VPC і регіоні
  основного, розмір `s-1vcpu-2gb` (інший — лише `--size` з переліку адаптера); ціна за годину друкується в плані до
  `--confirm`. Підготовка — та сама, що для вузла realtime: `deploy`, Docker, ufw (вхідний лише `22/tcp`), підкачка;
  каталог `/srv/t2f/rehearsal-server2`. Нічого не запускає. Якщо вузол уже є й підготовлений — відмова (код 2).
- `private-db open --peer <приватна IPv4 другого вузла>` — на основному вузлі окремий проєкт Compose
  `t2f-rehearsal-private-db` (`node/compose.private-db.yml`) з крихітним проксі (образ сервера, що вже на вузлі; лише
  `node:net`): Docker публікує 5432 і 6379 **лише на приватній адресі VPC основного** (не `0.0.0.0`, не публічна), проксі
  приймає з’єднання лише від `--peer`, решту закриває одразу. Postgres і Redis **не перезапускаються — простою немає**.
  Адреса VPC читається з вузла (інтерфейс з приватною адресою поза маршрутом за замовчуванням); `--peer` мусить бути
  RFC 1918 і в цій мережі — інакше відмова (код 2) до будь-якої зміни. Порт API Centrifugo (9000) не відкривається.
  Крок завершується перевіркою з вузла: `ss -Htln` і `docker compose port` — порти слухаються лише на приватній адресі.
  Невдача будь-якого кроку — автоматичний `close`.
- `private-db close` — прибирає контейнер, мережу й файли проксі (`compose.private-db.yml`, `private-db.env`,
  `private-db-proxy.mjs`) і перевіряє, що 5432/6379 на вузлі не слухаються; ідемпотентне. Стан вузла — як до `open`.
- `server2 up` — бере образ, що **зараз працює на основному** (`current.env` там; розбіжність з журналом розгортань —
  попередження), будує/бере його локально й доставляє на другий вузол так само, як `deploy` (`docker save | gzip` →
  `docker load`); туди ж `compose.server2.yml` (як `compose.yml`) і похідний `server.env`: з `.local/rehearsal/server.env`
  міняються **лише хости** `DATABASE_URI`, `REDIS_URL`, `T2F_CENTRIFUGO_URL` на приватну адресу основного (копія —
  `.local/rehearsal/server2.env`, значення не друкуються). Міграцій немає; з основного вузла — лише читання. Відмова
  (код 2), якщо `private-db` не відкрито саме для приватної адреси цього вузла.
- `server2 down` — прибирає контейнер і мережі проєкту `t2f-rehearsal-server2`, `server.env` на вузлі й
  `.local/rehearsal/server2.env`; ідемпотентне.
- `capacity server2-delete` — видаляє **лише** вузол з усіма трьома тегами (провайдер ще раз перевіряє теги в момент
  видалення); основний вузол — ніколи, ім’я саме нічого не обирає; після видалення друкує, що лишилося.
- Журнал навчання — `infra/ops/.local/rehearsal/server2.jsonl` (`private-db` і `server2`), потужності — `capacity.jsonl`.

Сервер на другому вузлі не досягає Centrifugo (9000 не відкрито): публікації з нього не доходять до клієнтів і кожна
чекає тайм-аут адаптера (1,8 с) — сервер від цього не падає (адаптер Centrifugo ніколи не кидає). Події, які під час
навчання шле власник оренди на другому вузлі, клієнти не побачать — це врахувати в сценарії навчання.

Порядок живого запуску (`<main>` — публічна адреса основного вузла, `<peer>` — приватна адреса другого з `status`):

```sh
node infra/ops/ops.mjs capacity --env rehearsal status                           # до: розбіжностей немає, другого вузла немає
node infra/ops/ops.mjs capacity --env rehearsal server2-create                   # план і ціна; далі те саме з --confirm rehearsal
node infra/ops/ops.mjs capacity --env rehearsal server2-create --confirm rehearsal
node infra/ops/ops.mjs capacity --env rehearsal status                           # приватна адреса другого вузла → <peer>
node infra/ops/ops.mjs private-db --env rehearsal --target <main> open --peer <peer>
node infra/ops/ops.mjs server2 --env rehearsal --target <main> up
node infra/ops/ops.mjs scheduler-drill --env rehearsal --target <main> --mode two-nodes --second <публічна адреса другого> --midnight 2026-12-31T10:00:00Z
node infra/ops/ops.mjs server2 --env rehearsal --target <main> down
node infra/ops/ops.mjs private-db --env rehearsal --target <main> close
node infra/ops/ops.mjs capacity --env rehearsal server2-delete --confirm rehearsal
node infra/ops/ops.mjs capacity --env rehearsal status                           # після: другого вузла немає
```

Перевірити ззовні (з машини оператора, не з VPC) **до `open` і після `close`, а також під час навчання**: порти 5432 і 6379
закриті з інтернету на обох вузлах — `nc -vz -w 3 <публічна адреса> 5432` і `… 6379` не з’єднуються (для основного й для
другого вузла). Під час навчання з другого вузла `nc -vz -w 3 <приватна адреса основного> 5432` з’єднується. Таймер
3 годин іде від `server2-create`; якщо щось пішло не так — однаково `down` → `close` → `server2-delete`.

## Навчання планувальника (`scheduler-drill`, SPEC-07 W56)

Лише `rehearsal` (`production`/`prelaunch` — код 2 ще до SSH). Розмір вузла навчання **не змінює ніколи** (П3):
`--resize` — відмова (код 2) навіть із `--confirm-resize`; збільшення — окремо `capacity`, лише після «так» власника.
Два екземпляри сервера ділять одну оренду планувальника (рядок у Postgres). Навчання:

1. перевіряє (лише читання): `one-node` — `MemAvailable` вузла ≥ 640 МБ екземпляра + 128 МБ запасу, інакше відмова з
   «бракує N МБ»; `two-nodes` — `private-db` відкрито саме для приватної адреси `--second` (адреса VPC читається з
   другого вузла) і другий екземпляр здоровий; обидва — сервер основного вузла здоровий. Відмова — код 2, нічого не змінено;
2. `one-node`: кладе `node/compose.drill.yml` поруч із `compose.yml` і піднімає `server-drill` (профіль
   `scheduler-drill`, 640m, без портів, поза мережею тунелю), чекає здоров’я; `two-nodes`: другий екземпляр уже працює
   (`server2 up`). Власником оренди в `two-nodes` має бути основний — інакше другий екземпляр перезапускається один раз;
3. `clock restart-night` → `clock set --at <північ − 60 с>` → (`clock speed 1`, якщо швидкість не 1); перевіряє, що
   `nextMoment` — саме `--midnight`;
4. рівно у віртуальну північ **вбиває** контейнер власника оренди без благодатного періоду
   (`docker compose kill -s SIGKILL <сервіс>`) — так моделюється смерть власника: оренда лишається за ним до кінця
   строку (~6 с), і саме це перехоплення має вкластися в 10 с. Благодатна зупинка (`docker compose stop`, SIGTERM) — інший,
   швидший шлях: `stop()` планувальника сервера звільняє оренду, і інший екземпляр бере її майже одразу; цей шлях
   навчання не міряє. Власника визначає за ім’ям хоста на початку `holder` (`<hostname>:<pid>:<hex>`) і `docker inspect`
   контейнерів обох екземплярів;
5. кожні 500 мс читає статус у вцілілого — до нового власника з більшою епохою (межа 10 с), потім `clock records --epoch`
   до запису всіх належних пар (дія, момент); друкує `DRILL takeover_ms=<n> late_ms=<n> duplicates=<n> missed=<n>` і
   `T2F_MEASURE {"metric":"lease-takeover-ms",…}`. Заміри — від SIGKILL (чи від реальної півночі) до середини
   виклику CLI, що вперше показав результат (точність — половина тривалості виклику `pnpm run clock`);
6. **завжди** (і після збою будь-якого кроку) відновлює: запускає вбитий контейнер (`docker compose start`) і чекає здоров’я, `clock real`,
   прибирає `server-drill` і `compose.drill.yml`, перевіряє `https://rehearsal.time2fest.com/api/health` через край.
   Не вийшло — код 1 і рядок журналу `restore` з `left` (що лишилося).

**Простій:** коли власник — сервер основного вузла, публічний `/api` репетиції недоступний від SIGKILL до повторного
запуску (≈ перехоплення + записи + старт, до ~1–2 хв). Початок і кінець простою — рядки `outage` у журналі
`.local/rehearsal/server2.jsonl` (там само всі кроки навчання, `sub: "scheduler-drill"`). Ctrl+C під час навчання
відновлення не гарантує — тоді вручну: `docker compose … start server`, `ops clock real`, `rm -sf server-drill`.

Коди: 0 — перехоплення ≤ 10 с, дублів і пропусків 0, усе відновлено; 1 — межу порушено, крок не вдався або відновлення
неповне; 2 — відмова до змін.

Порядок живого запуску, один вузол (лише якщо вистачає пам’яті; `<main>` — публічна адреса основного вузла):

```sh
node infra/ops/ops.mjs clock --env rehearsal --target <main> status                  # годинник реальний, оренда є
node infra/ops/ops.mjs scheduler-drill --env rehearsal --target <main> --mode one-node --midnight 2026-12-31T10:00:00Z
node infra/ops/ops.mjs clock --env rehearsal --target <main> status                  # після: реальний час
```

Два вузли — продовження розділу «Другий вузол репетиції» (після `server2 up`):

```sh
node infra/ops/ops.mjs scheduler-drill --env rehearsal --target <main> --mode two-nodes --second <публічна адреса другого> --midnight 2026-12-31T10:00:00Z
node infra/ops/ops.mjs server2 --env rehearsal --target <main> down
node infra/ops/ops.mjs private-db --env rehearsal --target <main> close
node infra/ops/ops.mjs capacity --env rehearsal server2-delete --confirm rehearsal
```

`--midnight` — північ поясу, на яку є моменти розкладу (ціла хвилина, кратна 15; `2026-12-31T10:00:00Z` — UTC+14).

## Перенесення імені між Worker’ами

```
pnpm edge:move-domain -- --name rehearsal.time2fest.com --to <worker> --secrets-file <шлях>
```

Це не-інтерактивний `wrangler deploy` цільового Worker’а з тим самим Custom Domain; ім’я «переїжджає» разом із розгортанням.
Зонд щосекунди питає `GET https://<ім’я>/` від 5 с до й 30 с після розгортання, міряє проміжок і записує, хто
відповів (заголовок `x-t2f-twin`). Журнал — `infra/ops/.local/rehearsal/edge.jsonl`. Явне від’єднання — лише запасний
шлях при конфлікті й лише для прив’язки, яку журнал записав як створену цією командою; робочі хости не від’єднуються ніколи.

Перенесення на Worker робочого домену (`t2f-edge-prelaunch`/`t2f-edge-production`) спершу робить ту саму перевірку
тримача, що й `deploy`, для всіх імен маршрутів середовища: Worker, з якого журнал цього середовища переносить ім’я
(`from`), віддає його без прапорця; будь-який інший тримач — лише з `--take-domain-from <worker>`, а запис DNS старого
сайту — лише з `--take-domain-from dns`. Для імені репетиції прапорець не приймається (код 2).

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

Виконано 2026-11-17/18 на вузлі репетиції (DigitalOcean `s-1vcpu-2gb`, FRA1): розгортання, відкат, заміна секрету краю, зміна розміру, тимчасовий вузол realtime і перенесення імені пройшли живими. Той самий порядок — для нового вузла; докладно — «Stage 2 runbook» наприкінці `docs/plans/SPEC-13a-server-deploy.plan.md`.

1. Власник створює вузол DigitalOcean (теги `t2f-managed`, `t2f-env-rehearsal`, `t2f-role-main`, його ключ SSH), кладе ключі R2
   і значення Access у `infra/ops/.local/rehearsal/server.env`.
2. `pnpm node:bootstrap -- --host <ip>`; відбиток ключа вузла, що надрукувала команда, **звірити з консоллю провайдера**.
3. `pnpm infra:cf apply --env rehearsal --secrets-file <файл>` (тунель, імена; токен тунелю пишеться в `.local`).
4. `pnpm edge:secret -- --env rehearsal --generate --target <ip> --secrets-file <файл>`.
5. `pnpm deploy:env -- --env rehearsal --target <ip> --probe --secrets-file <файл>`.
6. `pnpm edge:secret -- --env rehearsal --rotate --target <ip> --probe --secrets-file <файл>`.

`bootstrap` ідемпотентний: повторний запуск друкує «без змін». Він створює користувача `deploy` з ключем власника, ставить
Docker, створює каталог вузла, закриває брандмауер усім, крім TCP 22, і вимикає вхід root і паролі в SSH (лише після того,
як вхід `deploy` перевірено). Якщо в брандмауері вже є зайві правила, перевірка не пройде (код 1). SSH відкрито
всьому світу на порту 22 (`ufw allow 22/tcp`), лише за ключем, вхід root і паролі вимкнено; обмеження частоти
(`ufw limit`) не використовується, бо інструмент відкриває багато з’єднань. Вузол із правилом `limit` повторний
`bootstrap` переводить на `allow` одним рядком команди (спершу `allow`, потім видалення `limit`). Ще до SSH-кроку він вмикає підкачку
(вузол 1 vCPU / 2 GB, рішення 2026-11-17): файл `/swapfile` на 2 GB (режим 600, рядок у `/etc/fstab`) і
`vm.swappiness=10` у `/etc/sysctl.d/99-t2f-swap.conf`; якщо `swapon --show` уже показує `/swapfile`, файл не чіпається.
Вузол realtime (`capacity realtime-create`) проходить той самий перелік кроків. Якщо `--host` — ім’я, `bootstrap`
з’єднується з уже перевіреною IPv4-адресою цього імені (`-o HostKeyAlias=<ім’я>`, тож `known_hosts` лишається за
іменем), а не розв’язує ім’я вдруге; ім’я без IPv4-адреси — код 2.

**Група `docker` = root.** Користувач `deploy` у групі `docker` має права root на вузлі: будь-хто з його ключем може
запустити контейнер з коренем файлової системи хоста. Тому ключ розгортання (і секрет `T2F_REHEARSAL_SSH_KEY` у GitHub)
берегти як ключ root, а вхід root і паролі в SSH вимкнено саме для того, щоб цей ключ лишався єдиним входом.

## Розгортання з GitHub Actions

`.github/workflows/deploy.yml` — лише ручний запуск (`workflow_dispatch`) із входом `env` (єдине значення — `rehearsal`),
дії закріплені за SHA, секрети — лише за назвами через `env:`: `T2F_REHEARSAL_SSH_KEY`, `T2F_REHEARSAL_KNOWN_HOSTS`,
`T2F_REHEARSAL_HOST`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Викликає ту саму `pnpm deploy:env`.
Ключ розгортання — окрема пара SSH лише для користувача `deploy` вузла репетиції.

Робота йде лише з гілки `master` (`if: github.ref == 'refs/heads/master'`) і в GitHub Environment `rehearsal`. Ключ
пишеться у `$RUNNER_TEMP` після `pnpm install` (це звужує ризик, але не знімає його: фоновий процес зі скрипта встановлення дозволеного пакета дожив би до цього кроку) і прибирається останнім кроком
`if: always()`.

**Крок власника (один раз):** Settings → Environments → New environment `rehearsal`; Deployment branches and tags →
Selected branches → `master`; перенести в нього п’ять секретів вище (Environment secrets) і видалити їх із секретів
репозиторію (Repository secrets). Без цього гілка зі зміненим workflow бачила б секрети репозиторію; до перенесення
запуск знайде секрети репозиторію, після — лише з `master`.
