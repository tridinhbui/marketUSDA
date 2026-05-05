import https from "node:https";
import { getMarsApiKey } from "@/lib/mars-credentials";

const BASE = "https://marsapi.ams.usda.gov/services/v1.1/reports/3647";
const CHUNK_DAYS = 365;

export interface TurkeyRowRaw {
  week_start: string;
  week_end: string;
  condition: string;
  low_price: number | null;
  high_price: number | null;
  wtd_avg: number | null;
  volume_1000_lbs: number | null;
}

export interface TurkeyRangeResult {
  wholeHenRows: TurkeyRowRaw[];
  breastRows: TurkeyRowRaw[];
}

type TurkeySourceRow = Record<string, unknown>;

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoParts(iso: string): { y: number; m: number; d: number } | null {
  const p = iso.split("-").map(Number);
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  return { y: p[0], m: p[1], d: p[2] };
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

function* chunkRange(isoStart: string, isoEnd: string): Generator<{ from: Date; to: Date }> {
  let cursor = isoStart;
  while (compareIso(cursor, isoEnd) <= 0) {
    let endChunk = cursor;
    for (let i = 0; i < CHUNK_DAYS - 1; i++) {
      if (compareIso(endChunk, isoEnd) >= 0) break;
      endChunk = addDays(endChunk, 1);
    }
    if (compareIso(endChunk, isoEnd) > 0) endChunk = isoEnd;
    const pf = parseIsoParts(cursor)!;
    const pt = parseIsoParts(endChunk)!;
    yield {
      from: new Date(Date.UTC(pf.y, pf.m - 1, pf.d)),
      to: new Date(Date.UTC(pt.y, pt.m - 1, pt.d)),
    };
    if (compareIso(endChunk, isoEnd) >= 0) break;
    cursor = addDays(endChunk, 1);
  }
}

function fmtMdY(d: Date): string {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

function mapTurkeyRow(row: TurkeySourceRow, product: "wholeHen" | "breast"): TurkeyRowRaw | null {
  const isWholeHen =
    row.item === "Whole Young" &&
    row.class === "Hen" &&
    row.size === "8-16 lb" &&
    row.grade === "U.S. Grade A";
  const isBreast = row.item === "Breasts,Boneless/Skinless" && row.class === "Tom";

  if ((product === "wholeHen" && !isWholeHen) || (product === "breast" && !isBreast)) {
    return null;
  }

  const weekStart = String(row.report_begin_date ?? "");
  const wtdAvg = asNumberOrNull(row.wtd_avg_price ?? row.wtd_avg);
  if (!weekStart || wtdAvg == null) return null;

  return {
    week_start: weekStart,
    week_end: String(row.report_end_date ?? ""),
    condition: String(row.condition ?? ""),
    low_price: asNumberOrNull(row.low_price),
    high_price: asNumberOrNull(row.high_price),
    wtd_avg: wtdAvg,
    volume_1000_lbs: asNumberOrNull(row.volume),
  };
}

function turkeyRowKey(row: TurkeyRowRaw): string {
  return [
    row.week_start,
    row.week_end,
    row.condition,
    row.low_price ?? "",
    row.high_price ?? "",
    row.wtd_avg ?? "",
    row.volume_1000_lbs ?? "",
  ].join("\0");
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareTurkeyRows(a: TurkeyRowRaw, b: TurkeyRowRaw): number {
  const ta = weekStartToComparable(a.week_start);
  const tb = weekStartToComparable(b.week_start);
  return (
    ta - tb ||
    a.condition.localeCompare(b.condition) ||
    compareNullableNumber(a.low_price, b.low_price) ||
    compareNullableNumber(a.high_price, b.high_price) ||
    compareNullableNumber(a.wtd_avg, b.wtd_avg) ||
    compareNullableNumber(a.volume_1000_lbs, b.volume_1000_lbs)
  );
}

function dedupeTurkeyRows(rows: TurkeyRowRaw[]): TurkeyRowRaw[] {
  const map = new Map<string, TurkeyRowRaw>();
  for (const row of rows) map.set(turkeyRowKey(row), row);
  return [...map.values()].sort(compareTurkeyRows);
}

function weekStartToComparable(ws: string): number {
  const parts = ws.split("/");
  if (parts.length === 3) {
    const mm = Number(parts[0]);
    const dd = Number(parts[1]);
    const yy = Number(parts[2]);
    return Date.UTC(yy, mm - 1, dd);
  }
  const iso = ws.includes("T") ? ws : `${ws}T12:00:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function getJsonViaHttps(
  url: string,
  authHeader: string,
  rejectUnauthorized: boolean
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        port: 443,
        headers: {
          Authorization: authHeader,
          "User-Agent": "marketUSDA/1.0 (Next.js; USDA MARS 3647)",
          Accept: "application/json",
        },
        rejectUnauthorized,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if ((res.statusCode ?? 0) >= 300) {
            reject(new Error(`MARS 3647 HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`MARS 3647 JSON parse error: ${String(e)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("MARS 3647 request timeout"));
    });
  });
}

async function fetchJsonWithSslFallback(url: string, authHeader: string): Promise<unknown> {
  try {
    return await getJsonViaHttps(url, authHeader, true);
  } catch (e) {
    const msg = String(e);
    if (
      msg.includes("certificate") ||
      msg.includes("SSL") ||
      msg.includes("CERT") ||
      msg.includes("TLS")
    ) {
      return await getJsonViaHttps(url, authHeader, false);
    }
    throw e;
  }
}

async function fetchChunk(from: Date, to: Date, creds: string): Promise<TurkeyRangeResult> {
  const q = `report_begin_date=${fmtMdY(from)}:${fmtMdY(to)}`;
  const params = new URLSearchParams({
    q,
    reportSection: "Report Detail",
    allSections: "true",
  });
  const url = `${BASE}?${params.toString()}`;
  const authHeader = `Basic ${creds}`;
  const data = await fetchJsonWithSslFallback(url, authHeader);
  const sections = Array.isArray(data) ? data : [data];

  for (const sec of sections as TurkeySourceRow[]) {
    if (sec.reportSection !== "Report Detail") continue;

    const results = asArray<TurkeySourceRow>(sec.results as TurkeySourceRow[] | undefined);
    const wholeHenRows: TurkeyRowRaw[] = [];
    const breastRows: TurkeyRowRaw[] = [];

    for (const row of results) {
      const wholeHen = mapTurkeyRow(row, "wholeHen");
      if (wholeHen) wholeHenRows.push(wholeHen);

      const breast = mapTurkeyRow(row, "breast");
      if (breast) breastRows.push(breast);
    }

    return { wholeHenRows, breastRows };
  }

  return { wholeHenRows: [], breastRows: [] };
}

export async function fetchTurkeyDateRange(
  isoStart: string,
  isoEnd: string
): Promise<TurkeyRangeResult> {
  const s = parseIsoParts(isoStart);
  const e = parseIsoParts(isoEnd);
  if (!s || !e || compareIso(isoStart, isoEnd) > 0) {
    throw new Error("Invalid start or end date");
  }

  const key = getMarsApiKey();
  const creds = Buffer.from(`${key}:`, "utf8").toString("base64");
  const mergedWholeHen: TurkeyRowRaw[] = [];
  const mergedBreast: TurkeyRowRaw[] = [];

  for (const { from, to } of chunkRange(isoStart, isoEnd)) {
    const { wholeHenRows, breastRows } = await fetchChunk(from, to, creds);
    mergedWholeHen.push(...wholeHenRows);
    mergedBreast.push(...breastRows);
  }

  const startMs = Date.UTC(s.y, s.m - 1, s.d);
  const endMs = Date.UTC(e.y, e.m - 1, e.d, 23, 59, 59);

  const filterByRange = (rows: TurkeyRowRaw[]) =>
    rows.filter((row) => {
      const t = weekStartToComparable(row.week_start);
      return t >= startMs && t <= endMs;
    });

  return {
    wholeHenRows: filterByRange(dedupeTurkeyRows(mergedWholeHen)),
    breastRows: filterByRange(dedupeTurkeyRows(mergedBreast)),
  };
}
