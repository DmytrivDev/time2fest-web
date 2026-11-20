# Спайк П-RT: 30 000 WebSocket через Cloudflare

План, сценарії, пороги й вартість — `docs/backend/spike-rt-plan.md` (джерело правди). Тут — як ним керувати.

`node infra/ops/spike/spike.mjs <команда> …` з кореня `web/`. Змінні (лише назви; значення — у файлі `--secrets-file` поза git):

| Змінна | Для чого |
|---|---|
| `DIGITALOCEAN_API_TOKEN`, `T2F_DO_SSH_KEY` | `plan`, `create`, `status`, `run`, `delete`, а також `cf-up`/`cf-down` (знайти вузол realtime) |
| `CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` | `cf-up`, `cf-down`, `cf-status` (права — як у `infra/cloudflare/README.md`: Tunnel Edit, DNS Edit, Config Rules Edit) |

Платне й зміни в Cloudflare — лише після «так» власника (`docs/services/README.md`); кожну дію записати в `docs/services/server.md` і `docs/services/cloudflare.md` того ж дня.

## Етап 1 — порядок команд

```
F=--secrets-file <шлях>
node infra/ops/spike/spike.mjs plan $F                         # ціни з API, план; відмова, якщо ціна > плану §6 на 10%
node infra/ops/spike/spike.mjs create --confirm spike $F       # 1 × c-8 (fra1) + 4 × s-4vcpu-8gb (fra1, fra1, ams3, ams3), підготовка
node infra/ops/spike/spike.mjs cf-up --confirm spike $F        # тунель t2f-rtspike, CNAME rt-spike, одне конфіг-правило; токен → вузол
node infra/ops/spike/spike.mjs cf-status $F                    # перевірка: тунель має з’єднання, запис проксійований, правил 5
node infra/ops/spike/spike.mjs run S0 $F                       # димовий; не зелений — стоп, розбір, далі cf-down і delete
node infra/ops/spike/spike.mjs run S1 $F
node infra/ops/spike/spike.mjs run S2 $F
node infra/ops/spike/spike.mjs run S2 --storm-window 30s --label w30 $F
node infra/ops/spike/spike.mjs run S3 --live-history 120 $F    # див. «Відомі ризики» про історію live
node infra/ops/spike/spike.mjs run S4 $F
node infra/ops/spike/spike.mjs run S1 --label r1 $F
node infra/ops/spike/spike.mjs run S1 --label r2 $F
#   якщо S1 червоний через тунель: run S1 --protocol http2 --label h2 $F
node infra/ops/spike/spike.mjs status $F                       # між прогонами: вік, вартість, запас до 6 год
node infra/ops/spike/spike.mjs cf-down --confirm spike $F      # правило, запис, тунель; звірка: правил знову 4
node infra/ops/spike/spike.mjs delete --confirm spike $F       # лише вузли з t2f-managed + t2f-env-spike
node infra/ops/spike/spike.mjs status $F                       # вузлів 0
node infra/ops/spike/spike.mjs cf-status $F                    # тунелю й запису немає, спайку правил 0
pnpm capacity -- --env rehearsal status $F                     # розбіжностей немає
```

## Що робить кожна команда

- **`plan`** — лише читання: розміри й ціни з API провайдера, рядок на вузол, $/год разом, очікувана вартість; код 2, якщо розміру немає, ціна вища за план §6 більш ніж на 10% чи вузли за 6 год коштували б понад $8.
- **`create --confirm spike`** — та сама звірка цін; створює відсутні вузли з тегами `t2f-managed`, `t2f-env-spike`, `t2f-role-realtime|t2f-role-loadgen` і ключем `T2F_DO_SSH_KEY`; далі по SSH (root, `infra/ops/.local/spike/known_hosts`): Docker, ufw лише 22/tcp, chrony (зсув друкується), sysctl (`ip_local_port_range 1024 65000`, `fs.file-max`, `somaxconn`, черги) і nofile; генератори — образ `grafana/k6:2.4.0`; вузол realtime — `/srv/t2f/spike` з `compose.rtspike.yml`, свіжими ключами Centrifugo й паролем Redis (згенеровано локально в `infra/ops/.local/spike/{redis,centrifugo}.env`, режим 600, не друкуються), скриптом збирача; запускає redis і centrifugo. Повтор безпечний.
- **`cf-up --confirm spike`** — без вузла realtime нічого не робить. Створює відсутнє: тунель `t2f-rtspike` (керований віддалено, ingress `rt-spike.time2fest.com` `^/connection/` → `http://centrifugo:8000`, решта 404), CNAME `rt-spike` → `<id>.cfargotunnel.com` (проксі), ОДНЕ правило фази `http_config_settings` окремим `POST …/rulesets/{id}/rules` (`security_level: essentially_off`, `bic: false`, опис `t2f-spike: …`) — перелік правил ніколи не перезаписується. Токен тунелю — лише в `cloudflared.env` вузла (stdin SSH), не друкується й не зберігається локально; запускає дві копії cloudflared. Будь-який інший шлях чи id — відмова (`checkMutation`).
- **`cf-down --confirm spike`** — зупиняє cloudflared і стирає токен на вузлі; видаляє правило (за префіксом опису й точним виразом), запис (за ім’ям, лише CNAME на тунель спайку), з’єднання й тунель (за ім’ям); перечитує зону і звіряє кількість правил фази з тією, що була до `cf-up` (з журналу). Чужий запис чи правило з ім’ям `rt-spike` — відмова без змін.
- **`run <S0…S4>`** — відмова, якщо вузлам із прогоном буде понад 6 год, прогнозована вартість понад $8, немає токена тунелю або годинник вузла не синхронізовано. Спільний старт через 90 с; видавець і збирач (раз на 10 с: CPU, RAM, сокети, `docker stats`, `/metrics` Centrifugo) — на вузлі realtime, збирач CPU — на кожному генераторі, `spike.js` — на генераторах (S0 — 1 000 з’єднань, решта — 30 000, порівну). S3 — `docker restart` Centrifugo, S4 — однієї копії cloudflared у заплановану мить. Наприкінці — підсумки, журнали Centrifugo (рівень debug — причини розривів) і cloudflared у `infra/ops/.local/spike/runs/<час>-<сценарій>[-мітка]/` і екран висновку за порогами §5 (зелений/жовтий/червоний; «недостовірний», якщо генератор > 85% CPU). Прапорці `--conns`, `--ramp`, `--hold`, `--fast-last`, `--storm-at`, `--storm-window`, `--restart-at`, `--live-history`, `--log-level`, `--protocol http2`, `--label`.
- **`run … --local`** — той самий конвеєр на Docker цієї машини (redis і centrifugo з `compose.rtspike.yml`, без cloudflared; один k6; ≤ 1 000 з’єднань). `local-down` — прибрати контейнери, мережу й томи. `digest <тека прогону>` — повторна оцінка збереженого прогону.
- **`status`** — вузли з тегом `t2f-env-spike`: роль, розмір, адреса, вік, вартість, запас до 6 год; вузли з тегом спайку без `t2f-managed` — показуються, але не чіпаються.
- **`delete --confirm spike`** — видаляє лише вузли з обома тегами (адаптер перечитує теги в момент видалення), прибирає їхні адреси з `known_hosts` спайку, друкує, що лишилося.

Кожна змінна дія — рядок у `infra/ops/.local/spike/journal.jsonl` (без значень секретів).

## Відомі ризики

- **Історія `live`** у класі rehearsal — 10 повідомлень (5 с при 500 мс). У S3 клієнти повертаються з паузою до 20 с, тож відновлення частини підписок неминуче провалиться через розмір історії, а не транспорт. Для S3 — `--live-history 120` (60 с), висновок про робочий розмір — у звіт для SPEC-23.
- **Код помилки рукостискання**: k6 пише лише `websocket: bad handshake`, без статусу HTTP; коди 5xx/52x/1xxx Cloudflare — з аналітики зони за ім’ям `rt-spike` і журналів cloudflared.
- **Вузли спайку** лишаються зі входом root за ключем (короткоживучі, ufw лише 22); `sshd` не загартовується, як на робочих вузлах.
