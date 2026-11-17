# Специфікації хвиль бекенду

Специфікації хвиль пише `sdd-engineering:spec-creator` (формат — `sdd-engineering:sdd-format` §2, мова — `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §3). Загальна специфікація бекенду й карта хвиль — у корені Time2Fest (`specs/002-…`, `docs/backend/roadmap.md`). Індекс веде лише оркестратор. Процес — `D:/Work/Pets/Time2Fest/docs/backend/README.md`.

## Index

| Spec | Feature | Status | Packages | Supersedes |
|---|---|---|---|---|
| [SPEC-01](SPEC-01-workspace-seam.md) | Репозиторій і словник шва — робочий простір pnpm, пакети contracts і rules, домен site, словник причин і полів, CI, перевірка «лише додаванням» | approved | web, contracts, rules | none |
| [SPEC-03](SPEC-03-time-rules.md) | Модуль правил часу — один модуль `@time2fest/rules/time` для сайту й сервера, CI проти дублювання | approved | rules, web | none |
