import { NextResponse } from "next/server";
import { fetchHogsDateRange } from "@/lib/fetch-hogs-range";
import { fetchTurkeyDateRange } from "@/lib/fetch-turkey-range";
import { fetchPorkDateRange } from "@/lib/fetch-pork-range";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface PorkCachedRow {
  date: string;
  pork_carcass: number | null;
  pork_loin: number | null;
  pork_butt: number | null;
  pork_picnic: number | null;
  pork_rib: number | null;
  pork_ham: number | null;
  pork_belly: number | null;
}

async function readPorkRowsFromCache(start: string, end: string): Promise<PorkCachedRow[]> {
  const filePath = path.join(process.cwd(), "public", "data", "pork_cutout_daily.json");
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as PorkCachedRow[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r) => r && typeof r.date === "string" && r.date >= start && r.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

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
      const { rows } = await fetchTurkeyDateRange(start, end);
      return NextResponse.json({
        tab: "turkey",
        startDate: start,
        endDate: end,
        generatedAt,
        rows,
      });
    }
    if (tab === "pork") {
      try {
        const { rows } = await fetchPorkDateRange(start, end);
        return NextResponse.json({
          tab: "pork",
          startDate: start,
          endDate: end,
          generatedAt,
          rows,
          source: "live",
        });
      } catch {
        const rows = await readPorkRowsFromCache(start, end);
        return NextResponse.json({
          tab: "pork",
          startDate: start,
          endDate: end,
          generatedAt,
          rows,
          source: "cache",
        });
      }
    }
    return NextResponse.json({ error: 'Query parameter tab must be "hog", "turkey", or "pork".' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
