# Специфікації хвиль бекенду

Специфікації хвиль пише `sdd-engineering:spec-creator` (формат — `sdd-engineering:sdd-format` §2, мова — `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §3). Загальна специфікація бекенду й карта хвиль — у корені Time2Fest (`specs/002-…`, `docs/backend/roadmap.md`). Індекс веде лише оркестратор. Процес — `D:/Work/Pets/Time2Fest/docs/backend/README.md`.

## Index

| Spec | Feature | Status | Packages | Supersedes |
|---|---|---|---|---|
| [SPEC-01](SPEC-01-workspace-seam.md) | Репозиторій і словник шва — робочий простір pnpm, пакети contracts і rules, домен site, словник причин і полів, CI, перевірка «лише додаванням» | approved | web, contracts, rules | none |
| [SPEC-02](SPEC-02-server-skeleton.md) | Каркас сервера — Payload 3.91 + Postgres, стенд Docker, ізоляція дерев і замок, класи середовищ, модель помилок, дверцята й тестовий годинник, ліміти, ідемпотентність | approved | server, contracts, web | none |
| [SPEC-03](SPEC-03-time-rules.md) | Модуль правил часу — один модуль `@time2fest/rules/time` для сайту й сервера, CI проти дублювання | approved | rules, web | none |
| [SPEC-04](SPEC-04-admin-catalog.md) | Адмінка й каталог моментів — Access на сервері, ролі й ключі агентів, журнал і відкат, каркас першого екрана, режим без нагляду, каталог у Payload, поправки подій, `GET /api/catalog`, копія в R2, import/export, інструменти дошок для http | approved | server, web, contracts | none |
| [SPEC-13a](SPEC-13a-server-deploy.md) | Сервер, репетиційне середовище, розгортання, відкат — образ і Compose вузла, одна команда розгортання й відкату, `rehearsal` у краї й `infra`, заміна секрету краю, список робочих ідентифікаторів, скрипт потужності | approved | ops, server, edge, infra, docs-patch | none |
| [SPEC-06](SPEC-06-realtime.md) | Realtime — Centrifugo OSS з реєстром каналів і згенерованою конфігурацією, токен підключення через порт суб'єкта з розкидом строку, особисті канали `#` і 3014, публікація лише сервером з пакуванням 300 мс, історія й `resync`, клієнтський транспорт, дверцята токена, Centrifugo в CI, скрипти k6 | approved | server, web, contracts | none |
| [SPEC-07](SPEC-07-clock-server.md) | Сервер годинника — перелік моментів сезону в `@time2fest/rules`, планувальник «рівно раз» з орендою в Postgres і епохою фехтування, правила запізнення й порядок однакових моментів, спільний віртуальний час (тестовий годинник ↔ машина часу сайту, годинник репетиції з адмінки й `ops`), розбіжність краю й походження, chrony на вузлі, адмін-зріз «стан свята», дверцята ×60 / оренди / збою | approved | server, rules, web, edge, ops, contracts | none |
| [SPEC-09](SPEC-09-moderation.md) | Модерація тексту й AI — модуль `@time2fest/rules/text` для сайту й сервера з лінтом проти копій, суворіший запасний фільтр, шар постачальників (Haiku 5.5 основний, DeepSeek резервний) для модерації й перекладу з автоперемиканням і станом «повільно = недоступно», вердикти повідомлень, ніків і тостів, `POST /api/toasts/check`, стеля витрат $50 / ніч і $100 / місяць у Postgres з тривогами, адмін-зріз, фейк AI й дверцята | approved | rules, web, server, contracts | none |
