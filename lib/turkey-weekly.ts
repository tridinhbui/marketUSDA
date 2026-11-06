export interface TurkeyWeeklyRecord {
  week_start: string;
  week_end: string;
  breast_wtd_avg: number | null;
}

export interface TurkeyWeeklyConflict {
  week_start: string;
  week_end: string;
  prices: number[];
}

function priceOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) ? price : null;
}

export function mapTurkeyBreastRow(row: Record<string, unknown>): TurkeyWeeklyRecord | null {
  if (
    row.item !== "Breasts,Boneless/Skinless" ||
    row.class !== "Tom" ||
    row.trade_status !== "Domestic" ||
    row.condition !== "Fresh" ||
    row.environment !== "Conventional" ||
    row.freight !== "Delivered" ||
    row.grade !== "N/A"
  ) {
    return null;
  }

  const weekStart = String(row.report_begin_date ?? "");
  const weekEnd = String(row.report_end_date ?? "");
  if (!weekStart || !weekEnd) return null;

  return {
    week_start: weekStart,
    week_end: weekEnd,
    breast_wtd_avg: priceOrNull(row.wtd_avg_price),
  };
}

function sortDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : value;
}

export function normalizeTurkeyWeeklyRows(
  records: TurkeyWeeklyRecord[],
  onConflict: (conflict: TurkeyWeeklyConflict) => void = (conflict) =>
    console.error("[turkey] Conflicting USDA breast prices for one week", conflict)
): { rows: TurkeyWeeklyRecord[]; conflicts: TurkeyWeeklyConflict[] } {
  const byWeek = new Map<string, TurkeyWeeklyRecord>();
  const conflicts = new Map<string, TurkeyWeeklyConflict>();

  for (const record of records) {
    const key = `${record.week_start}\0${record.week_end}`;
    if (conflicts.has(key)) continue;

    const existing = byWeek.get(key);
    if (!existing) {
      byWeek.set(key, { ...record, breast_wtd_avg: priceOrNull(record.breast_wtd_avg) });
      continue;
    }

    const existingPrice = priceOrNull(existing.breast_wtd_avg);
    const incomingPrice = priceOrNull(record.breast_wtd_avg);
    if (existingPrice == null && incomingPrice != null) {
      byWeek.set(key, { ...record, breast_wtd_avg: incomingPrice });
    } else if (existingPrice != null && incomingPrice != null && existingPrice !== incomingPrice) {
      const conflict = {
        week_start: record.week_start,
        week_end: record.week_end,
        prices: [existingPrice, incomingPrice],
      };
      conflicts.set(key, conflict);
      byWeek.delete(key);
      onConflict(conflict);
    }
  }

  const rows = [...byWeek.values()].sort(
    (a, b) => sortDate(a.week_start).localeCompare(sortDate(b.week_start)) ||
      sortDate(a.week_end).localeCompare(sortDate(b.week_end))
  );
  return { rows, conflicts: [...conflicts.values()] };
}
