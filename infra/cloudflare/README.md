# infra/cloudflare — інфраструктура Cloudflare за описом

Нуль залежностей, звичайний Node ESM (`.mjs`, `// @ts-check`). Бажаний стан для середовищ `test` і `rehearsal`
(завжди обидва разом, бо `PUT` фази замінює весь список): тунель, проксовані CNAME, правила `http_request_firewall_custom` і `http_config_settings`, перевірка
налаштувань зони. Хости робочого домену (`time2fest.com`, `www`, `admin`) скрипт не чіпає.

## Запуск

```
pnpm infra:cf plan --env test|rehearsal [--secrets-file <шлях>] [--under-attack on|off] [--with-access]
```

```
pnpm infra:cf apply --env test|rehearsal [--secrets-file <шлях>] [--under-attack on|off] [--with-access]
                    [--allow-main-domain] [--allow-zone-settings] [--allow-delete]
```

- `plan` лише читає (GET) і друкує по рядку на зміну, або «без змін», а також вердикти запобіжника (код 0).
- `apply` бере замок `cloudflare` (`server/scripts/lib/lock.mjs`, тека `<lockDir>/cloudflare`, виключний режим),
  під ним читає поточний стан, рахує різницю й перевіряє запобіжником, потім застосовує по порядку: постачальник
  входу Google → застосунок Access (обидва лише з `--with-access`) → тунель → ingress → DNS → набори правил (PUT повного бажаного списку фази) → налаштування зони (лише з прапорцем).
  Повторний `apply` без зміни опису друкує «без змін» і не робить жодного запиту на зміну.
- Після змін `apply` друкує готовий рядок журналу для `docs/services/cloudflare.md`:
  `- <YYYY-MM-DD> — infra/cloudflare apply (<env>): <перелік змін>`.
- `--under-attack on|off` перекриває перемикач середовища `--env` лише на цей запуск.
- `--env` обирає середовище для файлу токена тунелю, `--under-attack` і Access; бажаний стан завжди містить усі
  середовища з `lib/config.mjs`, тож `plan`/`apply` з будь-яким `--env` показують і створюють обидва.

### Середовища

| Середовище | Тунель | Імена (проксовані CNAME) | Ingress |
|---|---|---|---|
| `test` | `t2f-test` | `o-test.time2fest.com` | `^/api/` → `host.docker.internal:4100`, решта — 404 |
| `rehearsal` | `t2f-rehearsal` | `o-rehearsal.time2fest.com`; `admin-rehearsal.time2fest.com` — лише разом з Access (нижче) | `o-rehearsal`: `^/api/` → `http://server:3000`; `admin-rehearsal`: лише `^/(admin\|cms-api\|_next)(/\|$)` → `http://server:3000`; решта — 404 |

**Realtime репетиції.** `rt-rehearsal.time2fest.com` — CNAME на тунель `t2f-rehearsal`, ingress `^/connection/` → `http://centrifugo:8000`
(клієнтський порт Centrifugo; API 9000 тунелю недосяжний). У блок-правило не входить (публічне ім'я); правило налаштувань
`t2f-realtime-rehearsal` ставить `security_level: off` і вимикає перевірку браузера (cloudflare-notes).

Правило `t2f-block-tunnel-hosts` блокує прямий доступ до імен тунелів (`o-*`); `admin-rehearsal` у нього не входить —
його закриває Access і перевірка JWT Access на сервері. Власних правил WAF — 2, конфіг-правил — 3.

**Ім'я адмінки лише разом з Access.** `admin-rehearsal` (ingress і CNAME) входить у бажаний стан лише тоді, коли
запуск має `--with-access` для цього середовища **або** в `.local/` є позначка `access-<env>.ok` і Cloudflare її
підтверджує. Позначку пише `apply --with-access` після того, як крок Access пройшов (застосунок створено, оновлено чи
він уже такий); без значень, лише дата. Позначці не вірять наосліп: без `--with-access` `plan`/`apply` читають
`GET /accounts/{a}/access/apps` (усі сторінки) і `GET /accounts/{a}/access/identity_providers` і лишають адмінку, лише
якщо є застосунок з `domain` = ім'я адмінки, хоча б однією політикою `allow`, у кожній політиці `allow` — лише правила
`include` з поштою (`{ email: { email } }`), і `allowed_idps` рівно `[<id t2f-google типу google>]`. Застосунку немає,
він без політик `allow`, політика пускає не лише за поштою чи вхід не лише через `t2f-google` — адмінка вимкнена
(ingress прибирається, залишок
імені йде в блок-правило), а `apply` видаляє застарілу позначку (`plan` лише пише, що її буде прибрано). Токену бракує
права читання Access (застосунків чи постачальників входу) — адмінка теж вимкнена, друкується назва права, запуск не падає; позначка лишається до
наступної перевірки. Без прапорця й без позначки `plan`/`apply` не показують і не створюють жодного об'єкта
`admin-rehearsal` і **не читають API Access** (токену може бракувати права). Якщо ж запис DNS чи ingress
`admin-rehearsal` уже є в Cloudflare (залишок давнішого запуску), а позначки немає — `plan` про це пише, `apply`
прибирає ingress адмінки, а саме ім'я додає в `t2f-block-tunnel-hosts` (запис DNS не видаляється). Шляхи адмінки:
`/admin` і `/cms-api` — із SPEC-04; `/_next` — статика адмінки Payload на Next.js (наживо ще не звірено: якщо адмінка
потребує ще якогось шляху, додати його в `ADMIN_PATH`, `lib/desired.mjs`). Позначку знято (файл видалено) — наступний
`apply` без `--with-access` прибере ingress адмінки й заблокує ім'я.

### Access (`--with-access`)

Лише з прапорцем `--with-access` скрипт читає (`GET /accounts/{a}/access/apps`, збіг за `domain`) і створює чи
оновлює застосунок Access `t2f-admin-<env>` для `adminHost` середовища (`self_hosted`, сесія 24 год, політика
`t2f-owner-<env>`: allow для пошт власника). Пошти — лише зі змінної `T2F_OWNER_EMAILS` (через кому; оточення
або `--secrets-file`, ніколи git); без неї — код 1. У вивід потрапляє лише кількість адрес; самі адреси
маскуються. Після створення друкується `aud` застосунку — значення для `T2F_ACCESS_AUD` сервера (не секрет).
Середовище без `adminHost` (`test`) з `--with-access` — код 1.

**Вхід лише через Google.** Власник входить в адмінку тільки своїм обліковим записом Google (з двофакторним
захистом); одноразовий PIN поштою не дозволено. Для цього з `--with-access` скрипт спершу забезпечує постачальника
входу (identity provider) рівня акаунта `t2f-google` типу `google`:

- `GET /accounts/{a}/access/identity_providers` (усі сторінки); немає — `POST` з тілом
  `{ name: "t2f-google", type: "google", config: { client_id, client_secret } }`; є з іншим `client_id` — `PUT` повним
  тілом; той самий `client_id` — «без змін» (секрет API назад не віддає, тож на кожному запуску його не перезаписуємо;
  щоб оновити лише секрет, змінити його в панелі Cloudflare вручну).
- Постачальник з ім'ям `t2f-google`, але іншого типу — чужий: запобіжник відмовляє (**код 2**), скрипт його не змінює
  й не видаляє. Чужі постачальники з іншими іменами не чіпаються.
- Постачальника можна створити чи оновити лише з `--with-access` і лише для `rehearsal` (інші середовища запобіжник
  відхиляє); `plan` показує рядок `create access-idp` / `update access-idp` або нічого.
- Застосунок отримує `allowed_idps: [<id t2f-google>]` і `auto_redirect_to_identity: true` (одразу на сторінку
  Google); застосунок з іншим `allowed_idps` оновлюється (`PUT`), як і при зміні пошт.

Змінні (лише з `--with-access`; оточення або `--secrets-file`, ніколи git): `CF_ACCESS_GOOGLE_CLIENT_ID`,
`CF_ACCESS_GOOGLE_CLIENT_SECRET` — клієнт OAuth Google (Google Cloud Console → Credentials → OAuth client ID, тип
«Web application», Authorized redirect URI — `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`). Бракує
будь-якої — код 1 до першого запиту, змінну названо. Обидва значення маскуються; секрет не потрапляє ні у вивід, ні в
план, ні в повідомлення про помилки, ні в позначку `.local`; з client id друкуються лише останні 6 символів.

Порядок `apply`: постачальник входу → застосунок Access з політикою → лише потім тунель, ingress і DNS адмінки.
Відмова на кроці Access (зокрема 403 на списку чи створенні постачальника — `needs permission: Account · Access:
Organizations, Identity Providers, and Groups · Edit`, **код 3**) зупиняє все, тож ім'я адмінки не з'являється без
свого захисту.

Перший запуск наживо:

```
pnpm infra:cf apply --env rehearsal --with-access --secrets-file <шлях>
```

де файл секретів містить `CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`,
`T2F_OWNER_EMAILS`, `CF_ACCESS_GOOGLE_CLIENT_ID`, `CF_ACCESS_GOOGLE_CLIENT_SECRET`.

### Запобіжник

Без явного прапорця `apply` завершується **кодом 2** без жодного запиту на зміну, якщо зміна:

| Зміна | Прапорець |
|---|---|
| зачіпає `time2fest.com`, `www.time2fest.com`, `admin.time2fest.com` | `--allow-main-domain` |
| налаштування всієї зони або правило без хоста | `--allow-zone-settings` |
| видаляє ресурс або правило (зокрема правило фази, якого немає в бажаному списку) | `--allow-delete` |

Поштові DNS-записи (MX, TXT) і будь-які інші типи, крім CNAME, не змінюються **ні з яким** прапорцем.
Невідомий вид зміни — так само заборонено.

### Відмова API

Перша відмова зупиняє `apply` (**код 3**): `refused <status> on <category> <method> <path>; needs permission:
<дозвіл>`, далі `applied before the refusal:` з переліком уже застосованого.

### Токен тунелю

Якщо `infra/cloudflare/.local/tunnel-<env>.env` ще немає, `apply` бере токен тунелю й пише туди
`TUNNEL_TOKEN=…` (режим 0600, наявний файл не перезаписується). Тека `.local/` — у `.gitignore`. Значення
токена ніколи не друкується.

## Локальний `cloudflared`

```
CLOUDFLARED_IMAGE=cloudflare/cloudflared@sha256:<digest> pnpm edge:tunnel:up
pnpm edge:tunnel:down
```

- `cloudflared/compose.yml`: `tunnel --no-autoupdate run`, токен лише з `../.local/tunnel-${T2F_EDGE_ENV:-test}.env`,
  до сервера — через `host.docker.internal`; жоден порт не публікується.
- Образ закріплюється лише дайджестом: значення `CLOUDFLARED_IMAGE` має вигляд
  `cloudflare/cloudflared@sha256:<digest>` (не тег і не `:latest`). Дайджест обирає керівник хвилі й записує в
  журнал сервісу `docs/services/cloudflare.md`; без `CLOUDFLARED_IMAGE` compose не запускається. Статичний
  тест `test/compose.test.mjs` перевіряє, що в compose немає `:latest` і жоден порт не публікується.
- Файл токена в git не потрапляє і ніколи не друкується.
- Змінні: `CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` (з оточення або з
  `--secrets-file`). Бракує будь-якої → код 1 до першого запиту.
- Значення секретів (`CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_API_TOKEN`, `T2F_EDGE_SECRET`,
  `T2F_OWNER_EMAILS` і кожна адреса з неї, `CF_ACCESS_GOOGLE_CLIENT_ID`, `CF_ACCESS_GOOGLE_CLIENT_SECRET`, токени тунелів) маскуються в кожному рядку виводу; тіло відмови API не друкується.
- `CLOUDFLARE_API_BASE` приймається лише як `http://127.0.0.1:<port>` / `http://localhost:<port>` (тести).

## Дозволи токена `CLOUDFLARE_API_TOKEN_INFRA`

- Account · Cloudflare Tunnel · Edit
- Zone · DNS · Edit
- Zone · Zone WAF · Edit
- Zone · Config Rules · Edit
- Zone · Zone Settings · Read (Edit лише з `--allow-zone-settings`)
- Zone · Bot Management · Read
- Account · Access: Apps and Policies · Edit (лише з `--with-access`); Read — щоб перевірити позначку `access-<env>.ok`
  (без нього адмінку вимкнено, див. вище)
- Account · Access: Organizations, Identity Providers, and Groups · Edit (лише з `--with-access`: постачальник
  входу Google; потрібне й для читання списку постачальників); Read — щоб перевірити позначку `access-<env>.ok`

## Тести

Усе проти фальшивого API (`test/support/fakeApi.mjs`), без мережі: `desired.test.mjs`, `plan.test.mjs`,
`guard.test.mjs`, `apply.test.mjs`, `access.test.mjs`, `lock.test.mjs` (два процеси проти loopback-фейка; тимчасова тека замка
через `T2F_LOCK_DIR`).
Перевірка — конфігурація `verify` пакета `infra` (`.claude/sdd-engineering.json`).
