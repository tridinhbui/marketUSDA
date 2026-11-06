import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from update_turkey_weekly import process_report


class WeeklyTurkeyUpdateTests(unittest.TestCase):
    def setUp(self):
        self.header = {
            "report_title": "Weekly National Turkey Report",
            "report_begin_date": "10/26/2026",
            "report_end_date": "10/30/2026",
        }
        self.breast = {
            **self.header,
            "item": "Breasts,Boneless/Skinless",
            "class": "Tom",
            "trade_status": "Domestic",
            "condition": "Fresh",
            "environment": "Conventional",
            "freight": "Delivered",
            "grade": "N/A",
            "wtd_avg_price": "289.60",
        }
        self.whole_fresh = {
            **self.header,
            "item": "Whole Young",
            "class": "Hen",
            "size": "8-16 lb",
            "grade": "U.S. Grade A",
            "trade_status": "Domestic",
            "condition": "Fresh",
            "low_price": "180",
            "high_price": "190",
            "wtd_avg_price": "185",
        }
        self.whole_frozen = {
            **self.whole_fresh,
            "condition": "Frozen",
            "low_price": "170",
            "high_price": "180",
            "wtd_avg_price": "175",
        }

    def test_updates_breast_and_upserts_fresh_frozen_independently(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            paths = (data_dir / "breast-a.json", data_dir / "breast-b.json")
            for path in paths:
                path.write_text(json.dumps({"rows": []}), encoding="utf-8")

            whole_db = {}

            def fake_upsert(rows):
                for row in rows:
                    key = (row["week_start"], row["week_end"], row["condition"])
                    whole_db[key] = row

            raw_rows = [
                self.breast,
                self.breast,
                self.whole_fresh,
                self.whole_frozen,
            ]
            for _ in range(2):
                process_report(
                    [self.header],
                    raw_rows,
                    date(2026, 11, 1),
                    fake_upsert,
                    paths,
                )

            payload = json.loads(paths[0].read_text(encoding="utf-8"))
            self.assertEqual(len(payload["rows"]), 1)
            self.assertEqual(payload["rows"][0]["breast_wtd_avg"], 289.6)
            self.assertNotIn("volume", payload["rows"][0])
            self.assertEqual(len(whole_db), 2)
            self.assertEqual(
                {row["condition"] for row in whole_db.values()},
                {"Fresh", "Frozen"},
            )
            self.assertEqual(
                {row["wtd_avg"] for row in whole_db.values()},
                {185.0, 175.0},
            )

    def test_stale_report_does_not_change_json_or_call_upsert(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "breast.json"
            original = json.dumps({"rows": [{"week_start": "old"}]})
            path.write_text(original, encoding="utf-8")
            upsert_calls = []

            changed = process_report(
                [self.header],
                [self.breast, self.whole_fresh],
                date(2026, 11, 5),
                upsert_calls.append,
                (path,),
            )

            self.assertFalse(changed)
            self.assertEqual(path.read_text(encoding="utf-8"), original)
            self.assertEqual(upsert_calls, [])

    def test_conflicting_breast_prices_abort_without_writing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "breast.json"
            original = json.dumps({"rows": []})
            path.write_text(original, encoding="utf-8")
            conflicting = {**self.breast, "wtd_avg_price": "290"}

            with self.assertRaisesRegex(ValueError, "conflicting prices"):
                process_report(
                    [self.header],
                    [self.breast, conflicting, self.whole_fresh],
                    date(2026, 11, 1),
                    lambda rows: self.fail("Whole Turkey must not be written"),
                    (path,),
                )
            self.assertEqual(path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
