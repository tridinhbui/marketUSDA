import assert from "node:assert/strict";
import test from "node:test";
import { mapTurkeyBreastRow, normalizeTurkeyWeeklyRows } from "../lib/turkey-weekly.ts";

const referenceRow = {
  report_begin_date: "10/26/2026",
  report_end_date: "10/30/2026",
  item: "Breasts,Boneless/Skinless",
  class: "Tom",
  trade_status: "Domestic",
  condition: "Fresh",
  environment: "Conventional",
  freight: "Delivered",
  grade: "N/A",
  wtd_avg_price: 289.6,
};

test("maps the selected current-week breast Wtd Avg and dates", () => {
  assert.deepEqual(mapTurkeyBreastRow(referenceRow), {
    week_start: "10/26/2026",
    week_end: "10/30/2026",
    breast_wtd_avg: 289.6,
  });
});

test("excludes rows outside the requested product category", () => {
  assert.equal(mapTurkeyBreastRow({ ...referenceRow, trade_status: "Export" }), null);
  assert.equal(mapTurkeyBreastRow({ ...referenceRow, condition: "Frozen" }), null);
  assert.equal(mapTurkeyBreastRow({ ...referenceRow, item: "Whole Young" }), null);
});

test("deduplicates weeks and favors a valid price over a missing price", () => {
  const record = mapTurkeyBreastRow(referenceRow)!;
  const result = normalizeTurkeyWeeklyRows([
    { ...record, breast_wtd_avg: null },
    record,
    record,
  ]);

  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.rows, [record]);
});

test("logs and excludes a week with conflicting non-null prices", () => {
  const record = mapTurkeyBreastRow(referenceRow)!;
  const conflicts: unknown[] = [];
  const result = normalizeTurkeyWeeklyRows(
    [record, { ...record, breast_wtd_avg: 290 }],
    (conflict) => conflicts.push(conflict)
  );

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.conflicts, [
    { week_start: "10/26/2026", week_end: "10/30/2026", prices: [289.6, 290] },
  ]);
  assert.deepEqual(conflicts, result.conflicts);
});
