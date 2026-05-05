import { NextResponse } from "next/server";
import { fetchPorkComprehensiveDateRange } from "@/lib/fetch-pork-comprehensive-range";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
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

  try {
    const { rows } = await fetchPorkComprehensiveDateRange(start, end);
    return NextResponse.json({
      tab: "pork-comprehensive",
      startDate: start,
      endDate: end,
      generatedAt: new Date().toISOString(),
      rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
