import { NextResponse } from "next/server";
import { fetchHogsDateRange } from "@/lib/fetch-hogs-range";
import { fetchTurkeyDateRange } from "@/lib/fetch-turkey-range";
import { fetchPorkDateRange } from "@/lib/fetch-pork-range";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/fetch-range?tab=hog|turkey&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Fetches live USDA data for the requested window (same sources as Python build scripts).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab");
  const start = (searchParams.get("start") ?? "").trim();
  const end = (searchParams.get("end") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json(
      { error: "Query parameters start and end must be calendar dates in YYYY-MM-DD format." },
      { status: 400 }
    );
  }
  if (start > end) {
    return NextResponse.json({ error: "start must be on or before end." }, { status: 400 });
  }

  const generatedAt = new Date().toISOString();

  try {
    if (tab === "hog") {
      const { rows } = await fetchHogsDateRange(start, end);
      return NextResponse.json({
        tab: "hog",
        startDate: start,
        endDate: end,
        generatedAt,
        rows,
      });
    }
    if (tab === "turkey") {
      const { wholeHenRows, breastRows } = await fetchTurkeyDateRange(start, end);
      return NextResponse.json({
        tab: "turkey",
        startDate: start,
        endDate: end,
        generatedAt,
        schemaVersion: 2,
        priceUnit: "Cents Per Lb",
        volumeUnit: "1,000 lbs",
        wholeHenRows,
        breastRows,
      });
    }
    if (tab === "pork") {
      const { rows } = await fetchPorkDateRange(start, end);
      return NextResponse.json({
        tab: "pork",
        startDate: start,
        endDate: end,
        generatedAt,
        rows,
      });
    }
    return NextResponse.json({ error: 'Query parameter tab must be "hog", "turkey", or "pork".' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
