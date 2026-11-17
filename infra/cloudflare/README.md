# infra/cloudflare — інфраструктура Cloudflare за описом

Нуль залежностей, звичайний Node ESM (`.mjs`, `// @ts-check`). Бажаний стан для середовища `test`:
тунель, проксований CNAME, правила `http_request_firewall_custom` і `http_config_settings`, перевірка
налаштувань зони. Хости робочого домену (`time2fest.com`, `www`, `admin`) скрипт не чіпає.

## Запуск

```
pnpm infra:cf plan --env test [--secrets-file <шлях>] [--under-attack on|off]
```

```
pnpm infra:cf apply --env test [--secrets-file <шлях>] [--under-attack on|off]
                    [--allow-main-domain] [--allow-zone-settings] [--allow-delete]
```

- `plan` лише читає (GET) і друкує по рядку на зміну, або «без змін», а також вердикти запобіжника (код 0).
- `apply` бере замок `cloudflare` (`server/scripts/lib/lock.mjs`, тека `<lockDir>/cloudflare`, виключний режим),
  під ним читає поточний стан, рахує різницю й перевіряє запобіжником, потім застосовує по порядку: тунель →
  ingress → DNS → набори правил (PUT повного бажаного списку фази) → налаштування зони (лише з прапорцем).
  Повторний `apply` без зміни опису друкує «без змін» і не робить жодного запиту на зміну.
- Після змін `apply` друкує готовий рядок журналу для `docs/services/cloudflare.md`:
  `- <YYYY-MM-DD> — infra/cloudflare apply (<env>): <перелік змін>`.
- `--under-attack on|off` перекриває перемикач середовища лише на цей запуск.

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
  токени тунелів) маскуються в кожному рядку виводу; тіло відмови API не друкується.
- `CLOUDFLARE_API_BASE` приймається лише як `http://127.0.0.1:<port>` / `http://localhost:<port>` (тести).

## Дозволи токена `CLOUDFLARE_API_TOKEN_INFRA`

- Account · Cloudflare Tunnel · Edit
- Zone · DNS · Edit
- Zone · Zone WAF · Edit
- Zone · Config Rules · Edit
- Zone · Zone Settings · Read (Edit лише з `--allow-zone-settings`)
- Zone · Bot Management · Read

## Тести

Усе проти фальшивого API (`test/support/fakeApi.mjs`), без мережі: `desired.test.mjs`, `plan.test.mjs`,
`guard.test.mjs`, `apply.test.mjs`, `lock.test.mjs` (два процеси проти loopback-фейка; тимчасова тека замка
через `T2F_LOCK_DIR`).
Перевірка — конфігурація `verify` пакета `infra` (`.claude/sdd-engineering.json`).
