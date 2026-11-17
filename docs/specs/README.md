# Специфікації хвиль бекенду

Специфікації хвиль пише `sdd-engineering:spec-creator` (формат — `sdd-engineering:sdd-format` §2, мова — `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §3). Загальна специфікація бекенду й карта хвиль — у корені Time2Fest (`specs/002-…`, `docs/backend/roadmap.md`). Індекс веде лише оркестратор. Процес — `D:/Work/Pets/Time2Fest/docs/backend/README.md`.

## Index

| Spec | Feature | Status | Packages | Supersedes |
|---|---|---|---|---|
| [SPEC-01](SPEC-01-workspace-seam.md) | Репозиторій і словник шва — робочий простір pnpm, пакети contracts і rules, домен site, словник причин і полів, CI, перевірка «лише додаванням» | approved | web, contracts, rules | none |
| [SPEC-02](SPEC-02-server-skeleton.md) | Каркас сервера — Payload 3.91 + Postgres, стенд Docker, ізоляція дерев і замок, класи середовищ, модель помилок, дверцята й тестовий годинник, ліміти, ідемпотентність | approved | server, contracts, web | none |
| [SPEC-03](SPEC-03-time-rules.md) | Модуль правил часу — один модуль `@time2fest/rules/time` для сайту й сервера, CI проти дублювання | approved | rules, web | none |
| [SPEC-04](SPEC-04-admin-catalog.md) | Адмінка й каталог моментів — Access на сервері, ролі й ключі агентів, журнал і відкат, каркас першого екрана, режим без нагляду, каталог у Payload, поправки подій, `GET /api/catalog`, копія в R2, import/export, інструменти дошок для http | draft | server, web, contracts | none |
