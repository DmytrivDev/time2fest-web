"""Мінімальний клієнт YouTube Data API v3 для скриптів Time2Fest.

Ключ береться ЛИШЕ зі змінної середовища YOUTUBE_API_KEY, передається в заголовку
X-Goog-Api-Key (не в адресі, тож не потрапляє в тексти помилок) і ніколи не виводиться.
Будь-який текст помилки проходить через redact().
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_BASE = "https://www.googleapis.com/youtube/v3"
SEARCH_DAILY_LIMIT = 100  # окремий кошик search.list (research.md розділ 4)
QUOTA_STATE = Path(__file__).resolve().parent / ".yt-quota.json"


class MissingKey(Exception):
    pass


class QuotaExceeded(Exception):
    pass


class ApiError(Exception):
    pass


def _key() -> str:
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not key:
        raise MissingKey("змінна середовища YOUTUBE_API_KEY не задана")
    return key


def redact(text: str) -> str:
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if key:
        text = text.replace(key, "***")
        text = text.replace(urllib.parse.quote(key), "***")
    return text


def _base() -> str:
    base = os.environ.get("YT_API_BASE", "").strip()
    # Перевизначення дозволене лише для локального макета в тестах: ключ не піде на сторонній хост.
    if base.startswith("http://127.0.0.1") or base.startswith("http://localhost"):
        return base.rstrip("/")
    return DEFAULT_BASE


def call(endpoint: str, params: dict) -> dict:
    key = _key()
    url = f"{_base()}/{endpoint}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"X-Goog-Api-Key": key, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {}
        err = body.get("error", {}) if isinstance(body, dict) else {}
        reasons = [x.get("reason", "") for x in err.get("errors", []) if isinstance(x, dict)]
        msg = redact(str(err.get("message", ""))) or f"HTTP {e.code}"
        if e.code == 403 and any(r in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded") for r in reasons):
            raise QuotaExceeded(msg) from None
        raise ApiError(f"HTTP {e.code}: {msg}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise ApiError(redact(f"мережева помилка: {getattr(e, 'reason', e)}")) from None


def _pt_date() -> str:
    return datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")


def searches_used_today() -> int:
    try:
        st = json.loads(QUOTA_STATE.read_text(encoding="utf-8"))
        if st.get("date") == _pt_date():
            return int(st.get("searches", 0))
    except Exception:
        pass
    return 0


def _bump_searches() -> None:
    QUOTA_STATE.write_text(
        json.dumps({"date": _pt_date(), "searches": searches_used_today() + 1}), encoding="utf-8"
    )


def search_list(params: dict) -> dict:
    """search.list з лічильником на добу; кидає QuotaExceeded до фактичного вичерпання ліміту."""
    if searches_used_today() >= SEARCH_DAILY_LIMIT:
        raise QuotaExceeded("локальний лічильник: 100 викликів search.list на добу вичерпано")
    data = call("search", params)
    _bump_searches()
    return data


def videos_list(ids: list[str], part: str) -> dict:
    """videos.list для пачки до 50 id (1 одиниця квоти на пачку)."""
    return call("videos", {"part": part, "id": ",".join(ids), "maxResults": 50})


def eprint(*a) -> None:
    print(*a, file=sys.stderr)
