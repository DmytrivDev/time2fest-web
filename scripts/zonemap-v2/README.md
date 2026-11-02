# Мапа поясів — збірка (v2)

Рішення власника 2026-11-02: основа мапи — стара мапа Time2Fest (Figma → JSX, перевірена вручну), пояси —
за офіційними даними на ніч 31.12.2026 → 1.01.2027, вигляд — «смуги поясів» (дошка `Desk-Map-Styles`, варіант C).
Результат — `data/zonemap.json` (комітиться); CI нічого не перегенеровує.

Потрібно: Python з `shapely`, `svgelements`, `tzdata==2026.6` (IANA 2026f); Node з `mapshaper` і `d3-geo` (devDependencies).

1. `extract.py <Old Project/time2fest-frontend/src/components/MapCanvas> <тека>/old_map.json` — JSX старої мапи → дані:
   пояси, країни (шляхи), лінії поясів в океані (TimeLines), кордони (Borders), лінія зміни дат.
2. `node scripts/zonemap-v2/tbb_project.mjs <тека>/tbb.json` (з `web/`) — межі поясів timezone-boundary-builder 2026f
   («timezones-now», суходіл; архів розпакувати в `.cache/tbb26f/`, зсуви — `.cache/tbb26f/offsets.json` з tzdata)
   → шляхи в кадрі старої мапи (Міллер, 1781×911, 4.947 px/°, лівий край 168.2° з.д., екватор y = 580).
3. `reassign.py <тека>` — кожен шматок країни → пояс за офіційними межами; країна з одним зсувом (tzdata `zone.tab`)
   отримує його цілком; рішення власника: Україна — +2 повністю, Китай — +8. Пише `pieces.json` і `changes.txt`.
4. `lines.py <тека>` — острови, яких бракувало (Чатем, Норонья, Південна Джорджія, Норфолк, Лорд-Гав), класи ліній
   (кордон / межа поясу / обидва), морські кордони острівних країн, області островів, смуги поясів → `map_data.json`.
5. `python -X utf8 scripts/zonemap-v2/to_site.py <тека>` — `map_data.json` → `data/zonemap.json` (компактні шляхи).

Перевірка: `compare.mjs` малює стару й офіційну мапи растром для порівняння по країнах.
