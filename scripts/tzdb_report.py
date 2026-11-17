"""Звіт розбіжностей tzdb (AC-51, AC-52): джерело проти встановленого tzdata. Джерело не змінюється.

  python -X utf8 scripts/tzdb_report.py --source data|<файл.json>|<url GET /api/catalog> [--out docs/tzdb-reports]

Пише <out>/<YYYY-MM-DD>-<tzdb>.md; код виходу 0 без розбіжностей, 1 з розбіжностями.
Зсув і північ рахуються з tzdata функціями генератора (за tz міст зі seed); розбіжності лише звітуються.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

import tzdata

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_schedule import NY_LOCAL, ROOT, SEED, offset_minutes, utc_iso  # noqa: E402


def load_source(src: str) -> dict:
    if src == "data":
        return json.loads((ROOT / "data" / "schedule.json").read_text(encoding="utf-8"))
    if src.startswith(("http://", "https://")):
        with urllib.request.urlopen(src, timeout=30) as r:  # лише читання
            return json.loads(r.read().decode("utf-8"))
    return json.loads(Path(src).read_text(encoding="utf-8"))


def compare(source: dict) -> list[tuple[str, int, int, str, str]]:
    seed = json.loads((SEED / "countries.seed.json").read_text(encoding="utf-8"))
    city_by_id = {c["id"]: c for co in seed["countries"] for c in co["cities"]}
    rows = []
    for z in source["zones"]:
        offs = set()
        for cn in z.get("countries", []):
            for city in cn.get("cities", []):
                if city["id"] in city_by_id:
                    offs.add(offset_minutes(city_by_id[city["id"]]))
        if not offs:
            continue
        exp = z["offsetMinutes"] if z["offsetMinutes"] in offs else min(offs)
        exp_mid = utc_iso(dt.datetime(2027, 1, 1) - dt.timedelta(minutes=exp))
        if exp != z["offsetMinutes"] or len(offs) > 1 or exp_mid != z["midnightUtc"]:
            rows.append((z["id"], z["offsetMinutes"], exp, z["midnightUtc"], exp_mid))
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "tzdb-reports")
    a = ap.parse_args(argv)
    rows = compare(load_source(a.source))
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    lines = [f"# Звіт розбіжностей tzdb {tzdata.IANA_VERSION}", "", f"Дата: {today}. Джерело: `{a.source}`. Момент: {NY_LOCAL.isoformat()} місцевого часу.", ""]
    if rows:
        lines += ["| Пояс | Зсув у джерелі | Зсув за tzdb | Північ у джерелі | Північ за tzdb |", "|---|---|---|---|---|"]
        lines += [f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} |" for r in rows]
    else:
        lines.append("no differences")
    a.out.mkdir(parents=True, exist_ok=True)
    path = a.out / f"{today}-{tzdata.IANA_VERSION}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(rows)} розбіжностей; звіт {path}")
    return 1 if rows else 0


if __name__ == "__main__":
    sys.exit(main())
