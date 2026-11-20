"""Збирання розкладу Нового року 2026/27 (T023).

  python -X utf8 scripts/build_schedule.py        # pnpm data:schedule

Вхід:  scripts/seed/countries.seed.json, scripts/seed/howto.seed.json, пакет tzdata 2026.6 (IANA 2026f: Куба −4 до листопада 2027)
Вихід: data/schedule.json, data/countries.json, data/schedule.schema.json (форма - specs/001-live-viewing/contracts/schedule.md)

Для кожного міста зі seed рахується зсув від UTC на момент 2027-01-01 00:00 за місцевим часом (з tzdb, а не
номінальний: Сідней +11, Окленд +13, Чатем +13:45). Міста групуються за зсувом у 37 поясів; 38-й, UTC-12
(Бейкер/Гауленд, безлюдні), задається вручну полем manualOffsetMinutes у seed. Скрипт падає, якщо версія tzdb не
2026f або порушено інваріанти 1-9 контракту.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import tzdata

EXPECTED_TZDB = "2026f"
EXPECTED_ZONES = 38
NY_LOCAL = dt.datetime(2027, 1, 1, 0, 0)
# Міста, яких на сайті не має бути, навіть якщо їх повернуть у seed (рішення власника 2026-11-20:
# Вейк, UM у UTC+12, — безлюдний атол; UM лишається через Мідвей і Бейкер).
EXCLUDED_CITY_IDS = {"wake"}

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "scripts" / "seed"
OUT = ROOT / "data"

def fail(msg: str) -> None:
    print(f"ПОМИЛКА: {msg}", file=sys.stderr)
    sys.exit(1)


def zone_id(offset: int) -> str:
    sign = "+" if offset >= 0 else "-"
    a = abs(offset)
    return f"utc{sign}{a // 60:02d}{a % 60:02d}"


def utc_iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def offset_minutes(city: dict) -> int:
    if "manualOffsetMinutes" in city:
        return int(city["manualOffsetMinutes"])
    off = ZoneInfo(city["tz"]).utcoffset(NY_LOCAL)
    return int(off.total_seconds() // 60)


def schema() -> dict:
    iso = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"}
    uk = {"type": "object", "required": ["uk"], "properties": {"uk": {"type": "string", "minLength": 1}}}
    ctype = {"enum": ["main", "webcam", "tv", "countdown-only"]}
    event = {
        "type": "object",
        "required": ["id", "midnightUtc", "isMainCelebration", "type", "popularity"],
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string", "pattern": r"^evt_[a-z0-9-]+_2027$"},
            "midnightUtc": iso,
            "isMainCelebration": {"type": "boolean"},
            "type": ctype,
            "popularity": {"type": "integer", "minimum": 0, "maximum": 100},
            "restrained": {"type": "object", "required": ["note"], "properties": {"note": uk}},
        },
    }
    city = {
        "type": "object",
        "required": ["id", "name", "celebrationType", "isCountryMain", "mapPoint", "events"],
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string", "pattern": r"^[a-z0-9-]+$"},
            "name": uk,
            "landmark": uk,
            "celebrationType": ctype,
            "isCountryMain": {"type": "boolean"},
            "mapPoint": {
                "type": "object", "required": ["x", "y"],
                "properties": {"x": {"type": "number", "minimum": 0, "maximum": 1}, "y": {"type": "number", "minimum": 0, "maximum": 1}},
            },
            "events": {"type": "array", "minItems": 1, "maxItems": 1, "items": event},
        },
    }
    country_node = {
        "type": "object", "required": ["iso", "cities"], "additionalProperties": False,
        "properties": {"iso": {"type": "string", "pattern": r"^[A-Z]{2}$"}, "cities": {"type": "array", "minItems": 1, "items": city}},
    }
    zone = {
        "type": "object",
        "required": ["id", "order", "offsetMinutes", "midnightUtc", "representativeCityId", "countries"],
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string", "pattern": r"^utc[+-]\d{4}$"},
            "order": {"type": "integer", "minimum": 0, "maximum": EXPECTED_ZONES - 1},
            "offsetMinutes": {"type": "integer", "minimum": -720, "maximum": 840},
            "midnightUtc": iso,
            "representativeCityId": {"type": "string"},
            "countries": {"type": "array", "minItems": 1, "items": country_node},
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "schedule.schema.json",
        "title": "Time2Fest schedule.json (specs/001-live-viewing/contracts/schedule.md)",
        "type": "object",
        "required": ["version", "season", "generatedAt", "tzdbVersion", "zones"],
        "additionalProperties": False,
        "properties": {
            "$schema": {"type": "string"},
            "version": {"const": 1},
            "season": {"const": "2026-27"},
            "generatedAt": iso,
            "tzdbVersion": {"const": EXPECTED_TZDB},
            "zones": {"type": "array", "minItems": EXPECTED_ZONES, "maxItems": EXPECTED_ZONES, "items": zone},
        },
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Збирання розкладу")
    ap.add_argument("--out", type=Path, default=OUT, help="каталог виводу (за замовчуванням data/)")
    out = ap.parse_args(argv).out
    if tzdata.IANA_VERSION != EXPECTED_TZDB:
        fail(f"tzdata.IANA_VERSION = {tzdata.IANA_VERSION!r}, очікується {EXPECTED_TZDB!r} (pip install tzdata==2026.6)")

    seed = json.loads((SEED / "countries.seed.json").read_text(encoding="utf-8"))
    howto = json.loads((SEED / "howto.seed.json").read_text(encoding="utf-8"))
    template = howto["template"]
    by_iso_howto = howto["byIso"]

    # --- міста -> пояси
    zones: dict[int, dict] = {}
    country_zone_ids: dict[str, set[str]] = {}
    for c in seed["countries"]:
        by_off: dict[int, list[dict]] = {}
        for city in c["cities"]:
            if city["id"] in EXCLUDED_CITY_IDS:
                continue
            by_off.setdefault(offset_minutes(city), []).append(city)
        for off, cities in by_off.items():
            mains = [x for x in cities if x.get("main")]
            if len(mains) != 1:
                fail(f"{c['iso']}: у поясі {zone_id(off)} має бути рівно одне головне місто, а їх {len(mains)}")
            z = zones.setdefault(off, {"offset": off, "countries": []})
            midnight = dt.datetime(2027, 1, 1) - dt.timedelta(minutes=off)
            node_cities = []
            for city in cities:
                is_main = bool(city.get("main"))
                ev_pop = c["popularity"] if is_main else max(0, c["popularity"] - 15)
                event = {
                    "id": f"evt_{city['id']}_2027",
                    "midnightUtc": utc_iso(midnight),
                    "isMainCelebration": is_main,
                    "type": city["celebrationType"],
                    "popularity": ev_pop,
                }
                node = {"id": city["id"], "name": city["name"]}
                if "landmark" in city:
                    node["landmark"] = city["landmark"]
                node.update({
                    "celebrationType": city["celebrationType"],
                    "isCountryMain": is_main,
                    "mapPoint": city["mapPoint"],
                    "events": [event],
                })
                node_cities.append(node)
            node_cities.sort(key=lambda n: (not n["isCountryMain"], n["id"]))
            z["countries"].append({"iso": c["iso"], "cities": node_cities})
            country_zone_ids.setdefault(c["iso"], set()).add(zone_id(off))

    ordered = sorted(zones.values(), key=lambda z: -z["offset"])  # найбільший зсув = найраніша північ
    if len(ordered) != EXPECTED_ZONES:
        fail(f"поясів {len(ordered)}, очікується {EXPECTED_ZONES}: {[zone_id(z['offset']) for z in ordered]}")

    country_pop = {c["iso"]: c["popularity"] for c in seed["countries"]}
    zone_nodes = []
    for i, z in enumerate(ordered):
        midnight = dt.datetime(2027, 1, 1) - dt.timedelta(minutes=z["offset"])
        best = None
        for cn in sorted(z["countries"], key=lambda x: x["iso"]):
            for city in cn["cities"]:
                ev = city["events"][0]
                key = (ev["isMainCelebration"], ev["popularity"], country_pop[cn["iso"]], city["id"])
                if best is None or key[:3] > best[0][:3]:
                    best = (key, city["id"])
        z["countries"].sort(key=lambda x: (-country_pop[x["iso"]], x["iso"]))
        zone_nodes.append({
            "id": zone_id(z["offset"]),
            "order": i,
            "offsetMinutes": z["offset"],
            "midnightUtc": utc_iso(midnight),
            "representativeCityId": best[1],
            "countries": z["countries"],
        })

    order_of = {z["id"]: z["order"] for z in zone_nodes}
    generated = utc_iso(dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None))
    schedule = {
        "$schema": "schedule.schema.json",
        "version": 1,
        "season": "2026-27",
        "generatedAt": generated,
        "tzdbVersion": EXPECTED_TZDB,
        "zones": zone_nodes,
    }

    # --- країни
    countries = []
    no_gender = []
    for c in seed["countries"]:
        if c["gender"] is None:
            no_gender.append(c["iso"])
        h = by_iso_howto.get(c["iso"], template)
        countries.append({
            "iso": c["iso"],
            "slug": c["slug"],
            "name": c["name"],
            "gender": c["gender"],
            "flagCode": c["iso"],
            "zoneIds": sorted(country_zone_ids[c["iso"]], key=lambda zid: order_of[zid]),
            "illustrationId": c["illustrationId"],
            "howTo": {"traditions": h["traditions"], "text": h["text"], "gallery": []},
            "popularity": c["popularity"],
        })
    countries_file = {"version": 1, "countries": countries}

    check_invariants(schedule, countries_file)

    out.mkdir(parents=True, exist_ok=True)
    dump = lambda p, obj: p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    dump(out / "schedule.json", schedule)
    dump(out / "countries.json", countries_file)
    dump(out / "schedule.schema.json", schema())

    n_cities = sum(len(cn["cities"]) for z in zone_nodes for cn in z["countries"])
    print(f"tzdb {tzdata.IANA_VERSION}; поясів {len(zone_nodes)}; країн {len(countries)}; міст/подій {n_cities}")
    print(f"перший пояс {zone_nodes[0]['id']} {zone_nodes[0]['midnightUtc']}; останній {zone_nodes[-1]['id']} {zone_nodes[-1]['midnightUtc']}")
    if no_gender:
        print(f"ПОПЕРЕДЖЕННЯ: {len(no_gender)} країн без роду (запасна фраза): {', '.join(no_gender)}", file=sys.stderr)
    print(f"записано: {out / 'schedule.json'}, {out / 'countries.json'}, {out / 'schedule.schema.json'}")


def check_invariants(schedule: dict, countries_file: dict) -> None:
    zs = schedule["zones"]
    countries = {c["iso"]: c for c in countries_file["countries"]}
    if len(zs) != EXPECTED_ZONES:
        fail("інваріант 1: поясів не 38")
    if zs[0]["offsetMinutes"] != 840 or zs[-1]["offsetMinutes"] != -720:
        fail("інваріант 1: перший має бути UTC+14, останній UTC-12")
    for i, z in enumerate(zs):
        if z["order"] != i:
            fail("інваріант 1: order непослідовний")
        if not z["midnightUtc"].endswith("Z"):
            fail("інваріант 2: midnightUtc не в UTC")
    times = [z["midnightUtc"] for z in zs]
    if len(set(times)) != len(times) or times != sorted(times):
        fail("інваріант 2: midnightUtc не унікальні або не зростають")
    ids: set[str] = set()
    seen_zone_by_country: dict[str, set[str]] = {}
    for z in zs:
        for cn in z["countries"]:
            if cn["iso"] not in countries:
                fail(f"інваріант 5: iso {cn['iso']} немає в countries.json")
            seen_zone_by_country.setdefault(cn["iso"], set()).add(z["id"])
            mains = [c for c in cn["cities"] if c["isCountryMain"]]
            mcel = [c for c in cn["cities"] if c["events"][0]["isMainCelebration"]]
            if len(mains) != 1 or len(mcel) != 1:
                fail(f"інваріант 4: {cn['iso']} у {z['id']}")
            for city in cn["cities"]:
                if city["id"] in ids:
                    fail(f"інваріант 6: повторний id міста {city['id']}")
                ids.add(city["id"])
                for ev in city["events"]:
                    if ev["id"] in ids:
                        fail(f"інваріант 6: повторний id події {ev['id']}")
                    ids.add(ev["id"])
                    if ev["id"] != f"evt_{city['id']}_2027":
                        fail(f"інваріант 6: eventId {ev['id']}")
                    if ev["midnightUtc"] != z["midnightUtc"]:
                        fail(f"інваріант 3: {ev['id']}")
        if z["representativeCityId"] not in ids:
            fail(f"representativeCityId {z['representativeCityId']} невідомий")
    for iso, c in countries.items():
        if set(c["zoneIds"]) != seen_zone_by_country.get(iso, set()):
            fail(f"інваріант 5: zoneIds {iso}")
        if len(c["howTo"]["traditions"]) != 3 or len(c["howTo"]["gallery"]) not in (0, 3):
            fail(f"howTo {iso}")
    slugs = [c["slug"] for c in countries.values()]
    if len(set(slugs)) != len(slugs):
        fail("slug країн неунікальні")


if __name__ == "__main__":
    main()
