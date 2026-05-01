import { getMarsApiKey } from "@/lib/mars-credentials";

const BASE = "https://marsapi.ams.usda.gov/services/v1.1/reports/3647";
const CHUNK_DAYS = 365;

export interface TurkeyRowRaw {
  week_start: string;
  week_end: string;
  condition: string;
  low_price: number;
  high_price: number;
  wtd_avg: number;
  volume_lbs: string | null;
  breast_wtd_avg: number | null;
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

function mapBreastRow(r: Record<string, unknown>): { week_start: string; condition: string; breast_wtd_avg: number } | null {
  if (r.item !== "Breasts,Boneless/Skinless" || r.class !== "Tom") return null;
  const ws = String(r.report_begin_date ?? "");
  const cond = String(r.condition ?? "");
  const wtd = Number(r.wtd_avg_price ?? NaN);
  if (!ws || !Number.isFinite(wtd)) return null;
  return { week_start: ws, condition: cond, breast_wtd_avg: wtd };
}

function mapRow(r: Record<string, unknown>): TurkeyRowRaw | null {
  if (
    r.item !== "Whole Young" ||
    r.class !== "Hen" ||
    r.size !== "8-16 lb" ||
    r.grade !== "U.S. Grade A"
  ) {
    return null;
  }
  const ws = String(r.report_begin_date ?? "");
  const we = String(r.report_end_date ?? "");
  const cond = String(r.condition ?? "");
  const low = Number(r.low_price);
  const high = Number(r.high_price);
  const wtd = Number(r.wtd_avg_price ?? r.wtd_avg ?? NaN);
  if (!ws || !Number.isFinite(wtd)) return null;
  const vol = r.volume != null && r.volume !== "" ? String(r.volume) : null;
  return {
    week_start: ws,
    week_end: we,
    condition: cond,
    low_price: Number.isFinite(low) ? low : 0,
    high_price: Number.isFinite(high) ? high : 0,
    wtd_avg: wtd,
    volume_lbs: vol,
    breast_wtd_avg: null,
  };
}

async function fetchChunk(from: Date, to: Date, creds: string): Promise<TurkeyRowRaw[]> {
  const q = `report_begin_date=${fmtMdY(from)}:${fmtMdY(to)}`;
  const params = new URLSearchParams({
    q,
    reportSection: "Report Detail",
    allSections: "true",
  });
  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, {
    next: { revalidate: 0 },
    headers: {
      Authorization: `Basic ${creds}`,
      "User-Agent": "marketUSDA/1.0 (Next.js; USDA MARS 3647)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MARS 3647 HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  const sections = Array.isArray(data) ? data : [data];
  for (const sec of sections as Record<string, unknown>[]) {
    if (sec.reportSection === "Report Detail") {
      const results = asArray<Record<string, unknown>>(sec.results as Record<string, unknown>[] | undefined);
      const breastMap = new Map<string, number>();
      for (const r of results) {
        const b = mapBreastRow(r);
        if (b) breastMap.set(`${b.week_start}|${b.condition}`, b.breast_wtd_avg);
      }
      const out: TurkeyRowRaw[] = [];
      for (const r of results) {
        const row = mapRow(r);
        if (row) {
          row.breast_wtd_avg = breastMap.get(`${row.week_start}|${row.condition}`) ?? null;
          out.push(row);
        }
      }
      return out;
    }
  }
  return [];
}

export async function fetchTurkeyDateRange(isoStart: string, isoEnd: string): Promise<{ rows: TurkeyRowRaw[] }> {
  const s = parseIsoParts(isoStart);
  const e = parseIsoParts(isoEnd);
  if (!s || !e || compareIso(isoStart, isoEnd) > 0) {
    throw new Error("Invalid start or end date");
  }

  const key = getMarsApiKey();
  const creds = Buffer.from(`${key}:`, "utf8").toString("base64");
  const merged: TurkeyRowRaw[] = [];

  for (const { from, to } of chunkRange(isoStart, isoEnd)) {
    const rows = await fetchChunk(from, to, creds);
    merged.push(...rows);
  }

  const seen = new Set<string>();
  const dedup: TurkeyRowRaw[] = [];
  for (const r of merged) {
    const k = `${r.week_start}|${r.condition}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }

  dedup.sort((a, b) => {
    const ta = Date.parse(a.week_start.includes("/") ? a.week_start : a.week_start);
    const tb = Date.parse(b.week_start.includes("/") ? b.week_start : b.week_start);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return a.week_start.localeCompare(b.week_start) || a.condition.localeCompare(b.condition);
  });

  const startMs = Date.UTC(s.y, s.m - 1, s.d);
  const endMs = Date.UTC(e.y, e.m - 1, e.d, 23, 59, 59);

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

  const filtered = dedup.filter((r) => {
    const t = weekStartToComparable(r.week_start);
    return t >= startMs && t <= endMs;
  });

  return { rows: filtered };
}
