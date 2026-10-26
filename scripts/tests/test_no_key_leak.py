"""T026: ключ YouTube не потрапляє в stdout, stderr, звіт і streams.json.

Запуск (з web/):  python -X utf8 -m unittest discover -s scripts/tests -v
Працює на локальному макеті API (YT_API_BASE=http://127.0.0.1:порт), справжній ключ не потрібен.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
FAKE_KEY = "AIzaSyFAKE-KEY-for-tests_0123456789abcdef"
MODE = {"value": "ok"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # тиша
        pass

    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if MODE["value"] == "quota":
            # навмисно «луною» повертаємо ключ у тексті помилки
            return self._send(403, {"error": {"code": 403, "message": f"quota for key={FAKE_KEY} exceeded",
                                              "errors": [{"reason": "quotaExceeded"}]}})
        if MODE["value"] == "bad":
            return self._send(400, {"error": {"code": 400, "message": f"API key not valid: {FAKE_KEY}", "errors": [{"reason": "badRequest"}]}})
        if self.path.startswith("/search"):
            return self._send(200, {"items": [{"id": {"videoId": "AAAAAAAAAAA"}, "snippet": {}}]})
        item = {
            "id": "AAAAAAAAAAA",
            "snippet": {"title": "Test 24/7 webcam", "channelTitle": "Chan", "liveBroadcastContent": "live", "description": ""},
            "status": {"embeddable": True, "privacyStatus": "public"},
            "liveStreamingDetails": {"actualStartTime": "2026-01-01T00:00:00Z", "concurrentViewers": "12"},
        }
        return self._send(200, {"items": [item]})


def streams_doc() -> dict:
    return {
        "version": 1, "season": "2026-27", "generatedAt": "2026-10-26T10:00:00Z", "lastCheckedAt": None,
        "chains": [{"eventId": "evt_london_2027", "sources": [{
            "id": "src_london_1", "platform": "youtube", "videoId": "AAAAAAAAAAA",
            "url": "https://www.youtube.com/watch?v=AAAAAAAAAAA", "kind": "webcam", "title": {"uk": "Лондон"},
            "order": 0, "status": "live", "embeddable": False, "isLive": False,
            "lastChecked": "2026-10-26T10:00:00Z", "verified": False,
        }]}],
    }


class NoKeyLeak(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def run_script(self, script: str, args: list[str], key: str | None = FAKE_KEY, mode: str = "ok"):
        MODE["value"] = mode
        env = {k: v for k, v in os.environ.items() if k != "YOUTUBE_API_KEY"}
        if key is not None:
            env["YOUTUBE_API_KEY"] = key
        env["YT_API_BASE"] = f"http://127.0.0.1:{self.port}"
        return subprocess.run(
            [sys.executable, "-X", "utf8", str(SCRIPTS / script), *args],
            capture_output=True, text=True, encoding="utf-8", env=env, timeout=60,
        )

    def assert_clean(self, *texts: str):
        for t in texts:
            self.assertNotIn(FAKE_KEY, t)

    def test_check_streams_clean(self):
        with tempfile.TemporaryDirectory() as d:
            f, rep = Path(d, "streams.json"), Path(d, "report.json")
            f.write_text(json.dumps(streams_doc(), ensure_ascii=False), encoding="utf-8")
            r = self.run_script("check_streams.py", ["--file", str(f), "--report", str(rep), "--write"])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assert_clean(r.stdout, r.stderr, rep.read_text(encoding="utf-8"), f.read_text(encoding="utf-8"))
            updated = json.loads(f.read_text(encoding="utf-8"))["chains"][0]["sources"][0]
            self.assertTrue(updated["embeddable"] and updated["isLive"])
            self.assertFalse(updated["verified"])

    def test_check_streams_without_write_keeps_file(self):
        with tempfile.TemporaryDirectory() as d:
            f, rep = Path(d, "streams.json"), Path(d, "report.json")
            f.write_text(json.dumps(streams_doc(), ensure_ascii=False), encoding="utf-8")
            before = f.read_text(encoding="utf-8")
            r = self.run_script("check_streams.py", ["--file", str(f), "--report", str(rep)])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(before, f.read_text(encoding="utf-8"))

    def test_check_streams_error_text_is_redacted(self):
        for mode in ("quota", "bad"):
            with tempfile.TemporaryDirectory() as d:
                f, rep = Path(d, "streams.json"), Path(d, "report.json")
                f.write_text(json.dumps(streams_doc()), encoding="utf-8")
                r = self.run_script("check_streams.py", ["--file", str(f), "--report", str(rep)], mode=mode)
                self.assertEqual(r.returncode, 2)
                self.assert_clean(r.stdout, r.stderr)

    def test_check_streams_missing_key_exit_2(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d, "streams.json")
            f.write_text(json.dumps(streams_doc()), encoding="utf-8")
            r = self.run_script("check_streams.py", ["--file", str(f), "--report", str(Path(d, "r.json"))], key=None)
            self.assertEqual(r.returncode, 2)
            self.assert_clean(r.stdout, r.stderr)

    def test_find_streams_clean(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d, "cand.json")
            r = self.run_script("find_streams.py", ["--countries", "GB", "--max-searches", "0", "--out", str(out)])
            self.assertEqual(r.returncode, 0, r.stderr)  # стеля 0: жодного search.list, квоту не чіпаємо
            self.assert_clean(r.stdout, r.stderr, out.read_text(encoding="utf-8"))

    def test_find_streams_error_text_is_redacted(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d, "cand.json")
            r = self.run_script("find_streams.py", ["--countries", "GB", "--max-searches", "1", "--out", str(out)], mode="bad")
            self.assertEqual(r.returncode, 2)
            self.assert_clean(r.stdout, r.stderr)

    def test_scripts_do_not_hardcode_key(self):
        for p in list(SCRIPTS.glob("*.py")) + list((SCRIPTS.parent / "data").glob("*.json")):
            self.assertNotIn("AIzaSy", p.read_text(encoding="utf-8"), p.name)


if __name__ == "__main__":
    unittest.main()
