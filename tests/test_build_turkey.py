import json
import unittest
from collections import Counter
from pathlib import Path

from _build_turkey import deduplicate_weekly_rows, map_breast_row


class TurkeyPipelineTests(unittest.TestCase):
    def setUp(self):
        self.api_row = {
            "report_begin_date": "10/26/2026",
            "report_end_date": "10/30/2026",
            "item": "Breasts,Boneless/Skinless",
            "class": "Tom",
            "trade_status": "Domestic",
            "condition": "Fresh",
            "environment": "Conventional",
            "freight": "Delivered",
            "grade": "N/A",
            "wtd_avg_price": "289.60",
        }

    def test_selects_current_breast_weighted_average(self):
        self.assertEqual(
            map_breast_row(self.api_row),
            {
                "week_start": "10/26/2026",
                "week_end": "10/30/2026",
                "breast_wtd_avg": 289.6,
            },
        )

    def test_excludes_nonmatching_category(self):
        self.assertIsNone(map_breast_row({**self.api_row, "trade_status": "Export"}))
        self.assertIsNone(map_breast_row({**self.api_row, "condition": "Frozen"}))

    def test_deduplicates_and_keeps_non_null_price(self):
        record = map_breast_row(self.api_row)
        rows = deduplicate_weekly_rows(
            [{**record, "breast_wtd_avg": None}, record, record]
        )
        self.assertEqual(rows, [record])

    def test_rejects_conflicting_prices(self):
        record = map_breast_row(self.api_row)
        with self.assertRaisesRegex(ValueError, "conflicting prices"):
            deduplicate_weekly_rows([record, {**record, "breast_wtd_avg": 290}])

    def test_generated_data_has_one_reference_and_one_record_per_week(self):
        path = Path(__file__).parents[1] / "public" / "data" / "turkey_hen_weekly.json"
        with path.open(encoding="utf-8") as data_file:
            rows = json.load(data_file)["rows"]

        self.assertGreaterEqual(len(rows), 214)
        week_counts = Counter((row["week_start"], row["week_end"]) for row in rows)
        self.assertTrue(all(count == 1 for count in week_counts.values()))
        for week, price in (
            (("10/26/2026", "10/30/2026"), 289.60),
            (("10/05/2026", "10/09/2026"), 285.38),
            (("09/21/2026", "09/25/2026"), 292.82),
        ):
            matches = [
                row
                for row in rows
                if (row["week_start"], row["week_end"]) == week
            ]
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]["breast_wtd_avg"], price)


if __name__ == "__main__":
    unittest.main()
