"""Щоденна перевірка джерел трансляцій (T026, contracts/streams.md).

  python -X utf8 scripts/check_streams.py [--file data/streams.json] [--write] [--report data/streams.check-report.json]

Для кожного StreamSource з platform = 'youtube': videos.list (snippet, status, liveStreamingDetails) ->
embeddable (status.embeddable), isLive (snippet.liveBroadcastContent == 'live'), lastChecked. Facebook та інші
платформи пропускаються. Джерело придатне, якщо isLive && embeddable; джерело зі status = 'expected', яке
YouTube позначає як 'upcoming' (ще не почалося) і яке вбудовується, теж не вважається проблемою.

Ключ - лише змінна YOUTUBE_API_KEY, у вивід, звіт і streams.json не потрапляє.
Коди виходу: 0 - у кожної події є придатне джерело; 1 - є події без придатного (див. звіт); 2 - помилка виконання.
З --write оновлює лише embeddable, isLive, lastChecked, generatedAt, lastCheckedAt; не чіпає verified, order, status.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import ytapi

ROOT = Path(__file__).resolve().parent.parent


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=str(ROOT / "data" / "streams.json"))
    ap.add_argument("--write", action="store_true", help="записати embeddable/isLive/lastChecked у streams.json")
    ap.add_argument("--report", default=str(ROOT / "data" / "streams.check-report.json"))
    args = ap.parse_args()

    path = Path(args.file)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        ytapi.eprint(f"Не вдалося прочитати {path}: {ytapi.redact(str(e))}")
        return 2

    yt_sources = [(ch, s) for ch in data.get("chains", []) for s in ch["sources"] if s.get("platform") == "youtube"]
    ids = sorted({s["videoId"] for _, s in yt_sources if s.get("videoId")})
    skipped = sum(1 for ch in data.get("chains", []) for s in ch["sources"] if s.get("platform") != "youtube")

    items: dict[str, dict] = {}
    quota = 0
    try:
        for i in range(0, len(ids), 50):
            resp = ytapi.videos_list(ids[i:i + 50], "snippet,status,liveStreamingDetails")
            quota += 1
            for it in resp.get("items", []):
                items[it["id"]] = it
    except ytapi.MissingKey as e:
        ytapi.eprint(f"Помилка: {e}")
        return 2
    except ytapi.QuotaExceeded as e:
        ytapi.eprint(f"Квота вичерпана: {ytapi.redact(str(e))}")
        return 2
    except ytapi.ApiError as e:
        ytapi.eprint(f"Помилка API: {ytapi.redact(str(e))}")
        return 2

    checked_at = now_iso()
    summary = {"sources": 0, "ok": 0, "notLive": 0, "notEmbeddable": 0, "missing": 0}
    problems = []
    usable_by_event: dict[str, bool] = {ch["eventId"]: False for ch in data.get("chains", [])}
    problem_idx: dict[str, list[int]] = {}

    for ch, s in yt_sources:
        summary["sources"] += 1
        it = items.get(s.get("videoId", ""))
        if it is None:
            s["embeddable"], s["isLive"] = False, False
            problem, usable = "not-found", False
            summary["missing"] += 1
        else:
            privacy = it.get("status", {}).get("privacyStatus")
            embeddable = bool(it.get("status", {}).get("embeddable"))
            bc = it.get("snippet", {}).get("liveBroadcastContent")
            live = bc == "live"
            s["embeddable"], s["isLive"] = embeddable, live
            upcoming_ok = s.get("status") == "expected" and bc == "upcoming"
            usable = embeddable and (live or upcoming_ok)
            problem = None
            if privacy == "private":
                problem = "private"
                summary["missing"] += 1
            elif not embeddable:
                problem = "not-embeddable"
                summary["notEmbeddable"] += 1
            elif not (live or upcoming_ok):
                problem = "not-live"
                summary["notLive"] += 1
            else:
                summary["ok"] += 1
        s["lastChecked"] = checked_at
        if usable:
            usable_by_event[ch["eventId"]] = True
        if problem:
            problems.append({"eventId": ch["eventId"], "sourceId": s["id"], "problem": problem, "chainStillHasUsableSource": False})

    for p in problems:
        p["chainStillHasUsableSource"] = usable_by_event[p["eventId"]]
    without = [e for e, ok in usable_by_event.items() if not ok]

    report = {
        "checkedAt": checked_at,
        "quotaUsedEstimate": quota,
        "summary": {**summary, "skipped": skipped},
        "problems": problems,
        "eventsWithoutUsableSource": without,
    }
    rp = Path(args.report)
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.write:
        data["generatedAt"] = checked_at
        data["lastCheckedAt"] = checked_at
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"джерел {summary['sources']}: придатних {summary['ok']}, не в ефірі {summary['notLive']}, "
        f"не вбудовуються {summary['notEmbeddable']}, відсутні {summary['missing']}, пропущено {skipped}"
    )
    print(f"подій без придатного джерела: {len(without)}" + (f" ({', '.join(without)})" if without else ""))
    print(f"запис streams.json: {'так' if args.write else 'ні'}; звіт: {rp}")
    return 1 if without else 0


if __name__ == "__main__":
    sys.exit(main())
