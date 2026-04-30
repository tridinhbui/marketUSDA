const BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/pork/LM_PK602";
const CHUNK_DAYS = 180;

const FIELDS = [
  "pork_carcass",
  "pork_loin",
  "pork_butt",
  "pork_picnic",
  "pork_rib",
  "pork_ham",
  "pork_belly",
] as const;

export type PorkField = (typeof FIELDS)[number];

export interface PorkRowRaw {
  date: string;
  pork_carcass: number | null;
  pork_loin: number | null;
  pork_butt: number | null;
  pork_picnic: number | null;
  pork_rib: number | null;
  pork_ham: number | null;
  pork_belly: number | null;
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
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function toIso(mmddyyyy: string): string | null {
  const parts = mmddyyyy.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseFloat2(v: string | undefined | null): number | null {
  if (v == null || v === "null" || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Parse MPR Datamart XML for LM_PK602.
 * Extracts "Cutout and Primal Values" (current day) from each <record report_date=...>
 * and "Cutout and Primal History" (prior days embedded in each report).
 */
function parseXml(xmlText: string): Map<string, PorkRowRaw> {
  const rows = new Map<string, PorkRowRaw>();

  function addRow(dateIso: string, attrs: Record<string, string>) {
    if (rows.has(dateIso)) return; // current-day takes priority
    const row: PorkRowRaw = {
      date: dateIso,
      pork_carcass: parseFloat2(attrs.pork_carcass),
      pork_loin: parseFloat2(attrs.pork_loin),
      pork_butt: parseFloat2(attrs.pork_butt),
      pork_picnic: parseFloat2(attrs.pork_picnic),
      pork_rib: parseFloat2(attrs.pork_rib),
      pork_ham: parseFloat2(attrs.pork_ham),
      pork_belly: parseFloat2(attrs.pork_belly),
    };
    if (Object.values(row).every((v, i) => i === 0 || v == null)) return; // all nulls
    rows.set(dateIso, row);
  }

  // Simple regex-based XML parse — avoids DOM dependency in Node edge runtime
  // Match top-level <record report_date="..."> blocks
  const dayRegex = /<record\s+report_date="([^"]+)"[^>]*>([\s\S]*?)<\/record>/g;
  let dayMatch: RegExpExecArray | null;

  while ((dayMatch = dayRegex.exec(xmlText)) !== null) {
    const reportDate = dayMatch[1]; // MM/DD/YYYY
    const dayBody = dayMatch[2];
    const reportDateIso = toIso(reportDate);

    // Find sub-reports within this day
    const subRegex = /<report\s+label="([^"]+)"[^>]*>([\s\S]*?)<\/report>/g;
    let subMatch: RegExpExecArray | null;

    while ((subMatch = subRegex.exec(dayBody)) !== null) {
      const label = subMatch[1];
      const subBody = subMatch[2];

      if (label === "Cutout and Primal Values" && reportDateIso) {
        // Single <record .../> with current-day values
        const recMatch = /<record\s+([^/]*)\/?>/g.exec(subBody);
        if (recMatch) {
          const attrs = parseAttrs(recMatch[1]);
          addRow(reportDateIso, attrs);
        }
      } else if (label === "Cutout and Primal History") {
        // Multiple <record prior_date="..." .../> rows
        const priorRegex = /<record\s+([^/]*)\/>/g;
        let priorMatch: RegExpExecArray | null;
        while ((priorMatch = priorRegex.exec(subBody)) !== null) {
          const attrs = parseAttrs(priorMatch[1]);
          const priorIso = attrs.prior_date ? toIso(attrs.prior_date) : null;
          if (priorIso) addRow(priorIso, attrs);
        }
      }
    }
  }

  return rows;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

async function fetchChunk(from: Date, to: Date): Promise<Map<string, PorkRowRaw>> {
  const filter = JSON.stringify({
    filters: [
      {
        fieldName: "Report date",
        operatorType: "BETWEEN",
        values: [fmtMdY(from), fmtMdY(to)],
      },
    ],
  });
  const url = `${BASE}?filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "marketUSDA/1.0 (+https://github.com/tridinhbui/marketUSDA)" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`LM_PK602 HTTP ${res.status} for ${fmtMdY(from)}–${fmtMdY(to)}`);
  const xml = await res.text();
  return parseXml(xml);
}

export async function fetchPorkDateRange(
  isoStart: string,
  isoEnd: string
): Promise<{ rows: PorkRowRaw[] }> {
  const merged = new Map<string, PorkRowRaw>();

  for (const { from, to } of chunkRange(isoStart, isoEnd)) {
    const chunk = await fetchChunk(from, to);
    for (const [k, v] of chunk) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }

  const rows = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { rows };
}
