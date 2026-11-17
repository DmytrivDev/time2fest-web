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
  під ним читає поточний стан, рахує різницю й перевіряє запобіжником, потім застосовує по порядку: тунель →
  ingress → DNS → набори правил (PUT повного бажаного списку фази) → налаштування зони (лише з прапорцем).
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
| `rehearsal` | `t2f-rehearsal` | `o-rehearsal.time2fest.com`, `admin-rehearsal.time2fest.com` | `o-rehearsal`: `^/api/` → `http://server:3000`; `admin-rehearsal`: усі шляхи → `http://server:3000`; решта — 404 |

Правило `t2f-block-tunnel-hosts` блокує прямий доступ до імен тунелів (`o-*`); `admin-rehearsal` у нього не входить —
його закриває Access і перевірка JWT Access на сервері. Власних правил WAF — 2, конфіг-правил — 3.

### Access (`--with-access`)

Лише з прапорцем `--with-access` скрипт читає (`GET /accounts/{a}/access/apps`, збіг за `domain`) і створює чи
оновлює застосунок Access `t2f-admin-<env>` для `adminHost` середовища (`self_hosted`, сесія 24 год, політика
`t2f-owner-<env>`: allow для пошт власника). Пошти — лише зі змінної `T2F_OWNER_EMAILS` (через кому; оточення
або `--secrets-file`, ніколи git); без неї — код 1. У вивід потрапляє лише кількість адрес; самі адреси
маскуються. Після створення друкується `aud` застосунку — значення для `T2F_ACCESS_AUD` сервера (не секрет).
Середовище без `adminHost` (`test`) з `--with-access` — код 1.

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
  `T2F_OWNER_EMAILS` і кожна адреса з неї, токени тунелів) маскуються в кожному рядку виводу; тіло відмови API не друкується.
- `CLOUDFLARE_API_BASE` приймається лише як `http://127.0.0.1:<port>` / `http://localhost:<port>` (тести).

## Дозволи токена `CLOUDFLARE_API_TOKEN_INFRA`

- Account · Cloudflare Tunnel · Edit
- Zone · DNS · Edit
- Zone · Zone WAF · Edit
- Zone · Config Rules · Edit
- Zone · Zone Settings · Read (Edit лише з `--allow-zone-settings`)
- Zone · Bot Management · Read
- Account · Access: Apps and Policies · Edit (лише з `--with-access`)

## Тести

Усе проти фальшивого API (`test/support/fakeApi.mjs`), без мережі: `desired.test.mjs`, `plan.test.mjs`,
`guard.test.mjs`, `apply.test.mjs`, `access.test.mjs`, `lock.test.mjs` (два процеси проти loopback-фейка; тимчасова тека замка
через `T2F_LOCK_DIR`).
Перевірка — конфігурація `verify` пакета `infra` (`.claude/sdd-engineering.json`).
