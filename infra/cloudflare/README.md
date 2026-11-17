# infra/cloudflare — інфраструктура Cloudflare за описом

Нуль залежностей, звичайний Node ESM (`.mjs`, `// @ts-check`). Бажаний стан для середовища `test`:
тунель, проксований CNAME, правила `http_request_firewall_custom` і `http_config_settings`, перевірка
налаштувань зони. Хости робочого домену (`time2fest.com`, `www`, `admin`) скрипт не чіпає.

## Запуск

```
pnpm infra:cf plan --env test [--secrets-file <шлях>] [--under-attack on|off]
```

- `plan` лише читає (GET) і друкує по рядку на зміну, або «без змін».
- `apply` підключається в наступній фазі; зараз завершується кодом 1 з `not implemented`.
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

Усе проти фальшивого API (`test/support/fakeApi.mjs`), без мережі: `desired.test.mjs`, `plan.test.mjs`.
Перевірка — конфігурація `verify` пакета `infra` (`.claude/sdd-engineering.json`).
