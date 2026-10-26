"""
Крок Python для мапи поясів (T079, research.md розділ 6): зсув кожного tzid на 2027-01-01 за tzdata 2026.5 (IANA 2026e).

Вхід:  .cache/tbb/combined-with-oceans-now.json (timezone-boundary-builder 2026e, не комітиться)
Вихід: .cache/tbb/offsets.json — { "<tzid>": <хвилини від UTC> }

Запуск: python -X utf8 scripts/build_zonemap_offsets.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import tzdata

EXPECTED_TZDB = "2026e"
AT = datetime(2027, 1, 1, 0, 0, tzinfo=timezone.utc)

root = Path(__file__).resolve().parent.parent
src = root / ".cache" / "tbb" / "combined-with-oceans-now.json"
out = root / ".cache" / "tbb" / "offsets.json"

if tzdata.IANA_VERSION != EXPECTED_TZDB:
    sys.exit(f"tzdata.IANA_VERSION = {tzdata.IANA_VERSION!r}, очікується {EXPECTED_TZDB!r}")
if not src.exists():
    sys.exit(f"Немає {src}: завантаж timezones-with-oceans-now.geojson.zip з релізу 2026e і розпакуй у .cache/tbb/")

data = json.loads(src.read_text(encoding="utf-8"))
offsets: dict[str, int] = {}
for f in data["features"]:
    tzid = f["properties"]["tzid"]
    delta = AT.astimezone(ZoneInfo(tzid)).utcoffset()
    offsets[tzid] = int(delta.total_seconds() // 60)

out.write_text(json.dumps(offsets, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"tzid: {len(offsets)}; унікальних зсувів: {len(set(offsets.values()))}")
