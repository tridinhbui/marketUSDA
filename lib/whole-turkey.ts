export type TurkeyConditionFilter = "all" | "Fresh" | "Frozen";

export interface WholeTurkeyRow {
  week_start: string;
  week_end: string;
  condition: string;
  low_price: number;
  high_price: number;
  wtd_avg: number;
  volume_lbs: string | null;
  isoDate: string;
}

export function wholeTurkeyIdentity(row: Pick<WholeTurkeyRow, "week_start" | "week_end" | "condition">): string {
  return `${row.week_start}\0${row.week_end}\0${row.condition}`;
}

export function filterWholeTurkeyRows(
  rows: WholeTurkeyRow[],
  start: string,
  end: string,
  condition: TurkeyConditionFilter
): WholeTurkeyRow[] {
  if (!start || !end || start > end) return [];
  return rows
    .filter((row) => row.isoDate >= start && row.isoDate <= end)
    .filter((row) => condition === "all" || row.condition === condition);
}
