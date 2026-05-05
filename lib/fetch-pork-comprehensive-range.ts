import https from "node:https";

const BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/pork/LM_PK680";
const CHUNK_DAYS = 730;

const FIELDS = [
  "carcass",
  "loin",
  "butt",
  "picnic",
  "rib",
  "ham",
  "belly",
] as const;

type PorkComprehensiveField = (typeof FIELDS)[number];

export interface PorkComprehensiveRowRaw {
  date: string;
  carcass: number | null;
  loin: number | null;
  butt: number | null;
  picnic: number | null;
  rib: number | null;
  ham: number | null;
  belly: number | null;
}

interface ParsedPorkComprehensiveRow extends PorkComprehensiveRowRaw {
  report_date: string;
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
  const n = parseFloat(v.replaceAll(",", ""));
  return Number.isNaN(n) ? null : n;
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

function pickWeeklyAverageAttrs(recordBody: string): Record<string, string> | null {
  const subRegex = /<report\s+label="([^"]+)"[^>]*>([\s\S]*?)<\/report>/g;
  let subMatch: RegExpExecArray | null;

  while ((subMatch = subRegex.exec(recordBody)) !== null) {
    if (subMatch[1] !== "Weekly Average Cutout and Primal Values") continue;
    const recMatch = /<record\s+([^/]*)\/?>/g.exec(subMatch[2]);
    if (!recMatch) return null;
    return parseAttrs(recMatch[1]);
  }

  return null;
}

function rowHasAnyValue(row: PorkComprehensiveRowRaw): boolean {
  return FIELDS.some((field) => row[field] != null);
}

function betterWeeklyRow(
  current: ParsedPorkComprehensiveRow,
  incoming: ParsedPorkComprehensiveRow
): ParsedPorkComprehensiveRow {
  if (incoming.report_date > current.report_date) return incoming;
  return current;
}

function parseXml(xmlText: string): Map<string, ParsedPorkComprehensiveRow> {
  const rows = new Map<string, ParsedPorkComprehensiveRow>();
  const dayRegex = /<record\s+report_date="([^"]+)"\s+report_for_date="([^"]+)"[^>]*>([\s\S]*?)<\/record>/g;
  let dayMatch: RegExpExecArray | null;

  while ((dayMatch = dayRegex.exec(xmlText)) !== null) {
    const reportDateIso = toIso(dayMatch[1]);
    const reportForDateIso = toIso(dayMatch[2]);
    if (!reportDateIso || !reportForDateIso) continue;

    const attrs = pickWeeklyAverageAttrs(dayMatch[3]);
    if (!attrs) continue;

    const row: ParsedPorkComprehensiveRow = {
      report_date: reportDateIso,
      date: reportForDateIso,
      carcass: parseFloat2(attrs.avg_cutout_carcass),
      loin: parseFloat2(attrs.avg_cutout_loin),
      butt: parseFloat2(attrs.avg_cutout_butt),
      picnic: parseFloat2(attrs.avg_cutout_picnic),
      rib: parseFloat2(attrs.avg_cutout_rib),
      ham: parseFloat2(attrs.avg_cutout_ham),
      belly: parseFloat2(attrs.avg_cutout_belly),
    };
    if (!rowHasAnyValue(row)) continue;

    const existing = rows.get(reportForDateIso);
    rows.set(reportForDateIso, existing ? betterWeeklyRow(existing, row) : row);
  }

  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCertificateError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /local issuer certificate|self signed certificate|unable to verify the first certificate/i.test(msg);
}

function getTextViaHttps(url: string, rejectUnauthorized: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "marketUSDA/1.0 (+https://github.com/tridinhbui/marketUSDA)" },
        rejectUnauthorized,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) {
            resolve(body);
            return;
          }
          reject(new Error(`LM_PK680 HTTP ${code}: ${body.slice(0, 240)}`));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function fetchChunk(from: Date, to: Date): Promise<Map<string, ParsedPorkComprehensiveRow>> {
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      let xml: string;
      try {
        xml = await getTextViaHttps(url, true);
      } catch (e) {
        if (!isCertificateError(e)) throw e;
        xml = await getTextViaHttps(url, false);
      }
      return parseXml(xml);
    } catch (e) {
      lastError = e;
      if (attempt < 4) await sleep(300 * attempt);
    }
  }
  throw new Error(
    `LM_PK680 fetch failed for ${fmtMdY(from)}-${fmtMdY(to)} after retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function mergeWeeklyRows(
  target: Map<string, ParsedPorkComprehensiveRow>,
  source: Map<string, ParsedPorkComprehensiveRow>
) {
  for (const [weekEnding, row] of source) {
    const existing = target.get(weekEnding);
    target.set(weekEnding, existing ? betterWeeklyRow(existing, row) : row);
  }
}

export async function fetchPorkComprehensiveDateRange(
  isoStart: string,
  isoEnd: string
): Promise<{ rows: PorkComprehensiveRowRaw[] }> {
  const startParts = parseIsoParts(isoStart);
  const endParts = parseIsoParts(isoEnd);
  if (!startParts || !endParts || compareIso(isoStart, isoEnd) > 0) {
    throw new Error("Invalid start or end date");
  }

  const fetchEnd = addDays(isoEnd, 7);
  const merged = new Map<string, ParsedPorkComprehensiveRow>();
  for (const { from, to } of chunkRange(isoStart, fetchEnd)) {
    mergeWeeklyRows(merged, await fetchChunk(from, to));
  }

  const rows = [...merged.values()]
    .filter((row) => row.date >= isoStart && row.date <= isoEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ report_date: _reportDate, ...row }) => row);

  return { rows };
}
