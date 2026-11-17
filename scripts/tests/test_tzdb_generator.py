"""W7 (AC-50): генератор на закріпленій tzdb дає ті самі пояси, що data/schedule.json.

Запуск (з web/):  python -X utf8 scripts/tests/test_tzdb_generator.py
Виводить у тимчасовий каталог, data/ не чіпає.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import tzdata

ROOT = Path(__file__).resolve().parent.parent.parent
GEN = ROOT / "scripts" / "build_schedule.py"


class TzdbGenerator(unittest.TestCase):
    def test_pinned_tzdb(self) -> None:
        self.assertEqual(tzdata.IANA_VERSION, "2026f")  # падає, а не пропускається

    def test_generator_matches_data(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, "-X", "utf8", str(GEN), "--out", tmp], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            got = json.loads((Path(tmp) / "schedule.json").read_text(encoding="utf-8"))
        want = json.loads((ROOT / "data" / "schedule.json").read_text(encoding="utf-8"))
        self.assertEqual(len(got["zones"]), 38)
        self.assertEqual(got["tzdbVersion"], "2026f")
        self.assertEqual(want["tzdbVersion"], "2026f")

        def pick(d: dict) -> list:
            return [(z["id"], z["offsetMinutes"], z["midnightUtc"]) for z in d["zones"]]

        self.assertEqual(pick(got), pick(want))

    def test_seeds_hold_no_midnight(self) -> None:
        for f in (ROOT / "scripts" / "seed").glob("*.json"):
            self.assertNotIn("midnightUtc", f.read_text(encoding="utf-8"), f.name)


if __name__ == "__main__":
    unittest.main()
