import { XMLParser } from "fast-xml-parser";

const API_BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/hogs/LM_HG217";
const CHUNK_DAYS = 170;

export interface HogRow {
  date: string;
  national: number | null;
  iowaMn: number | null;
  western: number | null;
}

export interface HogFetchLogEntry {
  t: string;
  message: string;
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function parseIsoParts(iso: string): { y: number; m: number; d: number } | null {
  const p = iso.split("-").map(Number);
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  return { y: p[0], m: p[1], d: p[2] };
}

function buildUrl(start: { y: number; m: number; d: number }, end: { y: number; m: number; d: number }): string {
  const filter = {
    filters: [
      {
        fieldName: "Report date",
        operatorType: "BETWEEN",
        values: [`${start.m}/${start.d}/${start.y}`, `${end.m}/${end.d}/${end.y}`],
      },
    ],
  };
  return `${API_BASE}?filter=${encodeURIComponent(JSON.stringify(filter))}`;
}

function toIsoUsDate(us: string): string {
  const [month, day, year] = us.split("/").map(Number);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function toFloatOrNull(value: string | undefined): number | null {
  if (value == null || value === "" || value === "null") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => tagName === "record" || tagName === "report",
});

function parseLmHg217Xml(xmlText: string): HogRow[] {
  const doc = parser.parse(xmlText) as Record<string, unknown>;
  // API wraps the report in `<results>…</results>`; `doc.report` is never set.
  const results = doc.results as Record<string, unknown> | undefined;
  const reportNode = (results?.report ?? doc.report) as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const reports = asArray<Record<string, unknown>>(reportNode);
  const topReport = reports[0];
  if (!topReport) return [];

  const rows: HogRow[] = [];
  for (const dayRecord of asArray<Record<string, unknown>>(topReport.record as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const usDate = dayRecord["@_report_date"] as string | undefined;
    if (!usDate) continue;

    let national: number | null = null;
    let iowaMn: number | null = null;
    let western: number | null = null;

    for (const section of asArray<Record<string, unknown>>(dayRecord.report as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      const label = section["@_label"] as string | undefined;
      if (
        label !== "National Volume and Price Data" &&
        label !== "Iowa/Minnesota Volume and Price Data" &&
        label !== "Western Cornbelt Volume and Price Data"
      ) {
        continue;
      }

      for (const row of asArray<Record<string, unknown>>(section.record as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
        if ((row["@_purchase_type"] as string | undefined) !== "Negotiated (carcass basis)") continue;
        const v = toFloatOrNull(row["@_wtd_avg"] as string | undefined);
        if (label === "National Volume and Price Data") national = v;
        else if (label === "Iowa/Minnesota Volume and Price Data") iowaMn = v;
        else western = v;
      }
    }

    rows.push({
      date: toIsoUsDate(usDate),
      national,
      iowaMn,
      western,
    });
  }

  return rows;
}

function addDays(iso: string, delta: number): string {
  const p = parseIsoParts(iso);
  if (!p) throw new Error("Invalid date");
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + delta);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

function* chunkRange(isoStart: string, isoEnd: string): Generator<{ start: string; end: string }> {
  let cursor = isoStart;
  while (compareIso(cursor, isoEnd) <= 0) {
    let endChunk = cursor;
    for (let i = 0; i < CHUNK_DAYS - 1; i++) {
      if (compareIso(endChunk, isoEnd) >= 0) break;
      endChunk = addDays(endChunk, 1);
    }
    if (compareIso(endChunk, isoEnd) > 0) endChunk = isoEnd;
    yield { start: cursor, end: endChunk };
    if (compareIso(endChunk, isoEnd) >= 0) break;
    cursor = addDays(endChunk, 1);
  }
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    next: { revalidate: 0 },
    headers: { "User-Agent": "marketUSDA/1.0 (Next.js; USDA public LM_HG217)" },
  });
  if (!res.ok) throw new Error(`LM_HG217 HTTP ${res.status}`);
  return res.text();
}

export async function fetchHogsDateRange(
  isoStart: string,
  isoEnd: string,
  onLog?: (entry: HogFetchLogEntry) => void
): Promise<{ rows: HogRow[] }> {
  const s = parseIsoParts(isoStart);
  const e = parseIsoParts(isoEnd);
  if (!s || !e || compareIso(isoStart, isoEnd) > 0) {
    throw new Error("Invalid start or end date");
  }

  const log = (message: string) => {
    onLog?.({ t: new Date().toISOString(), message });
  };

  log(`LM_HG217 · window ${isoStart} → ${isoEnd}`);
  const byDate = new Map<string, HogRow>();
  let chunkIndex = 0;

  for (const { start, end } of chunkRange(isoStart, isoEnd)) {
    chunkIndex += 1;
    const ss = parseIsoParts(start)!;
    const ee = parseIsoParts(end)!;
    const url = buildUrl(ss, ee);
    log(`Chunk ${chunkIndex}: GET Datamart ${start} … ${end}`);
    const xml = await fetchXml(url);
    const chunkRows = parseLmHg217Xml(xml);
    let inRange = 0;
    for (const row of chunkRows) {
      if (row.date >= isoStart && row.date <= isoEnd) {
        byDate.set(row.date, row);
        inRange += 1;
      }
    }
    log(`Chunk ${chunkIndex}: ${chunkRows.length} day(s) in XML → ${inRange} kept in range`);
  }

  const rows = [...byDate.keys()].sort(compareIso).map((d) => byDate.get(d)!);
  log(`Finished · ${rows.length} merged trading day(s)`);
  return { rows };
}
