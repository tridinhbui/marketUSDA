import assert from "node:assert/strict";
import test from "node:test";
import { filterWholeTurkeyRows, wholeTurkeyIdentity, type WholeTurkeyRow } from "../lib/whole-turkey.ts";

const fresh: WholeTurkeyRow = {
  week_start: "09/21/2026",
  week_end: "09/25/2026",
  condition: "Fresh",
  low_price: 183,
  high_price: 183,
  wtd_avg: 183,
  volume_lbs: "80",
  isoDate: "2026-09-21",
};

const frozen: WholeTurkeyRow = {
  ...fresh,
  condition: "Frozen",
  low_price: 181.61,
  high_price: 181.61,
  wtd_avg: 181.61,
  volume_lbs: "102",
};

test("keeps Fresh and Frozen records for the same week distinct", () => {
  assert.notEqual(wholeTurkeyIdentity(fresh), wholeTurkeyIdentity(frozen));
  assert.deepEqual(filterWholeTurkeyRows([fresh, frozen], "2026-09-21", "2026-09-25", "all"), [
    fresh,
    frozen,
  ]);
});

test("filters whole turkey rows by condition and date range", () => {
  assert.deepEqual(filterWholeTurkeyRows([fresh, frozen], "2026-09-21", "2026-09-25", "Fresh"), [
    fresh,
  ]);
  assert.deepEqual(filterWholeTurkeyRows([fresh, frozen], "2026-09-21", "2026-09-25", "Frozen"), [
    frozen,
  ]);
  assert.deepEqual(filterWholeTurkeyRows([fresh, frozen], "2026-09-26", "2026-09-30", "all"), []);
});
