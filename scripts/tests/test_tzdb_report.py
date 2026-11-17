"""W8 (AC-51, AC-52): звіт розбіжностей tzdb. Запуск (з web/): python -X utf8 scripts/tests/test_tzdb_report.py"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TOOL = ROOT / "scripts" / "tzdb_report.py"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "tzdb" / "shifted.json"


def run(source: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([sys.executable, "-X", "utf8", str(TOOL), "--source", source, "--out", tmp], capture_output=True, text=True, encoding="utf-8")
        files = list(Path(tmp).glob("*.md"))
        assert len(files) == 1, r.stderr
        return r.returncode, files[0].read_text(encoding="utf-8")


class TzdbReport(unittest.TestCase):
    def test_shifted_fixture(self) -> None:
        code, text = run(str(FIXTURE))
        self.assertEqual(code, 1)
        rows = [ln for ln in text.splitlines() if ln.startswith("| utc")]
        self.assertEqual(len(rows), 1)

    def test_data_is_clean(self) -> None:
        code, text = run("data")
        self.assertEqual(code, 0)
        self.assertIn("no differences", text)
        self.assertFalse([ln for ln in text.splitlines() if ln.startswith("| utc")])


if __name__ == "__main__":
    unittest.main()
