"""Пошук кандидатів цілодобових прямих (T025, contracts/streams.md).

  python -X utf8 scripts/find_streams.py --countries GB,FR,DE,AU,NZ,JP,BR,US --max-per-country 5

Ключ - лише змінна YOUTUBE_API_KEY (ніколи не виводиться). Вихід - data/streams.candidates.json
для ручного відбору, а не streams.json. search.list має окремий кошик 100 викликів на добу:
скрипт веде локальний лічильник і зупиняється до вичерпання (--max-searches, за замовчуванням 30).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import ytapi

ROOT = Path(__file__).resolve().parent.parent

# Місто за замовчуванням (для eventId) і пошукові запити за країною.
CITY = {
    "GB": "london", "FR": "paris", "DE": "berlin", "AU": "sydney", "NZ": "auckland", "JP": "tokyo",
    "BR": "sao-paulo", "US": "new-york", "AE": "dubai", "KR": "seoul", "ES": "madrid", "IT": "rome",
}
QUERIES = {
    "GB": ["London live webcam 24/7", "Big Ben Tower Bridge live cam"],
    "FR": ["Paris live webcam 24/7", "Eiffel Tower live cam"],
    "DE": ["Berlin live webcam 24/7", "Brandenburg Gate live cam"],
    "AU": ["Sydney Harbour live webcam 24/7", "Sydney Opera House live cam"],
    "NZ": ["Auckland live webcam 24/7", "Auckland Sky Tower live cam"],
    "JP": ["Tokyo live camera 24/7", "Shibuya Crossing live camera"],
    "BR": ["Rio de Janeiro Copacabana live cam", "Sao Paulo live camera 24/7"],
    "US": ["New York Times Square live cam 24/7", "New York skyline live webcam"],
    "AE": ["Dubai live webcam 24/7", "Burj Khalifa live cam"],
}
KW_247 = re.compile(r"24\s*/\s*7|24\s*h|live\s*cam|webcam|skyline|livecam|cam\b", re.I)
KW_BAD = re.compile(r"replay|music|radio|lofi|lo-fi|chill|podcast|news|reaction|\bgame\b|minecraft", re.I)


def score(item: dict) -> tuple[int, str]:
    sn = item.get("snippet", {})
    st = item.get("status", {})
    ls = item.get("liveStreamingDetails", {})
    text = f"{sn.get('title', '')} {sn.get('description', '')[:300]}"
    s, why = 0, []
    live = sn.get("liveBroadcastContent") == "live"
    emb = bool(st.get("embeddable"))
    if live:
        s += 40
        why.append("live")
    if emb:
        s += 20
        why.append("embeddable")
    if st.get("privacyStatus") == "public":
        s += 5
    if ls.get("actualStartTime") and not ls.get("scheduledEndTime") and not ls.get("actualEndTime"):
        s += 10
        why.append("без запланованого кінця")
    if KW_247.search(text):
        s += 10
        why.append("ознаки 24/7")
    if KW_BAD.search(text):
        s -= 15
        why.append("штраф: музика/новини/повтор")
    v = ls.get("concurrentViewers")
    if v is not None and str(v).isdigit() and int(v) > 0:
        s += min(15, int(math.log10(int(v)) * 4))
        why.append(f"глядачів {v}")
    return max(0, min(100, s)), ", ".join(why)


def event_id_for(iso: str, schedule: dict | None) -> str:
    city = CITY.get(iso, iso.lower())
    if schedule:
        fallback = None
        for z in schedule["zones"]:
            for c in z["countries"]:
                if c["iso"] != iso:
                    continue
                for ct in c["cities"]:
                    if ct["id"] == city:
                        return ct["events"][0]["id"]
                    if ct["isCountryMain"] and fallback is None:
                        fallback = ct["events"][0]["id"]
        if fallback:
            return fallback
    return f"evt_{city}_2027"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--countries", default="GB,FR,DE,AU,NZ,JP,BR,US")
    ap.add_argument("--max-per-country", type=int, default=5)
    ap.add_argument("--max-searches", type=int, default=30, help="стеля search.list для цього запуску")
    ap.add_argument("--results-per-search", type=int, default=15)
    ap.add_argument("--out", default=str(ROOT / "data" / "streams.candidates.json"))
    ap.add_argument("--queries", action="append", default=[], help="ISO=запит (можна кілька разів), замінює типові")
    args = ap.parse_args()

    custom: dict[str, list[str]] = {}
    for q in args.queries:
        iso, _, text = q.partition("=")
        custom.setdefault(iso.upper(), []).append(text)

    sched_path = ROOT / "data" / "schedule.json"
    schedule = json.loads(sched_path.read_text(encoding="utf-8")) if sched_path.exists() else None

    quota = 0
    searches = 0
    out_countries = []
    try:
        for iso in [c.strip().upper() for c in args.countries.split(",") if c.strip()]:
            queries = custom.get(iso) or QUERIES.get(iso) or [f"{iso} live webcam 24/7"]
            found: dict[str, dict] = {}
            for q in queries:
                if searches >= args.max_searches:
                    ytapi.eprint(f"[{iso}] досягнуто стелі --max-searches={args.max_searches}, запит пропущено")
                    break
                data = ytapi.search_list({
                    "part": "snippet", "type": "video", "eventType": "live", "videoEmbeddable": "true",
                    "q": q, "maxResults": args.results_per_search,
                })
                searches += 1
                quota += 1
                for it in data.get("items", []):
                    vid = it.get("id", {}).get("videoId")
                    if vid:
                        found[vid] = it
            cands = []
            ids = list(found)
            for i in range(0, len(ids), 50):
                data = ytapi.videos_list(ids[i:i + 50], "snippet,status,liveStreamingDetails,statistics")
                quota += 1
                for item in data.get("items", []):
                    sc, why = score(item)
                    sn = item["snippet"]
                    ls = item.get("liveStreamingDetails", {})
                    c = {
                        "videoId": item["id"],
                        "url": f"https://www.youtube.com/watch?v={item['id']}",
                        "channelTitle": sn.get("channelTitle", ""),
                        "title": sn.get("title", ""),
                        "isLive": sn.get("liveBroadcastContent") == "live",
                        "embeddable": bool(item.get("status", {}).get("embeddable")),
                        "score": sc,
                        "reason": why,
                    }
                    if str(ls.get("concurrentViewers", "")).isdigit():
                        c["concurrentViewers"] = int(ls["concurrentViewers"])
                    cands.append(c)
            cands.sort(key=lambda c: -c["score"])
            out_countries.append({
                "iso": iso,
                "eventId": event_id_for(iso, schedule),
                "candidates": cands[: args.max_per_country],
            })
            print(f"{iso}: знайдено {len(found)}, у вихід {min(len(cands), args.max_per_country)}")
    except ytapi.MissingKey as e:
        ytapi.eprint(f"Помилка: {e}")
        return 2
    except ytapi.QuotaExceeded as e:
        ytapi.eprint(f"Квота вичерпана: {ytapi.redact(str(e))}; записую те, що встигли")
    except ytapi.ApiError as e:
        ytapi.eprint(f"Помилка API: {ytapi.redact(str(e))}")
        return 2

    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "quotaUsedEstimate": quota,
        "countries": out_countries,
    }
    p = Path(args.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"search.list викликів: {searches}; сьогодні всього: {ytapi.searches_used_today()}/{ytapi.SEARCH_DAILY_LIMIT}; записано {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
