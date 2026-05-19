"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const HOG_URL = "/data/lm_hg217_daily_prices.json";
const TURKEY_URL = "/data/turkey_hen_weekly.json";
const PORK_URL = "/data/pork_cutout_daily.json";
const PORK_COMPREHENSIVE_URL = "/data/pork_comprehensive_weekly.json";

type Tab = "hog" | "turkey" | "pork" | "pork-comprehensive" | "admin";

interface HogRow {
  date: string;
  national: number | null;
  iowaMn: number | null;
  western: number | null;
}

interface HogRefreshLogRow {
  t: string;
  message: string;
}

interface PorkRefreshLogRow {
  t: string;
  message: string;
}

interface TurkeyRefreshLogRow {
  t: string;
  message: string;
}

type HogStreamEvent =
  | { type: "log"; t: string; message: string }
  | { type: "done"; generatedAt: string; rows: HogRow[] }
  | { type: "error"; error: string };

type PorkStreamEvent =
  | { type: "log"; t: string; message: string }
  | { type: "done"; generatedAt: string; rows: PorkRow[] }
  | { type: "error"; error: string };

function formatLogTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

interface HogPayload {
  generatedAt?: string;
  rows: HogRow[];
}

interface TurkeyRow {
  week_start: string;
  week_end: string;
  condition: string;
  low_price: number | null;
  high_price: number | null;
  wtd_avg: number | null;
  volume_1000_lbs: number | null;
  isoDate: string;
}

interface TurkeyRowWire {
  week_start: string;
  week_end: string;
  condition: string;
  low_price?: number | string | null;
  high_price?: number | string | null;
  wtd_avg?: number | string | null;
  volume_1000_lbs?: number | string | null;
  volume_lbs?: number | string | null;
  breast_wtd_avg?: number | string | null;
}

interface TurkeyPayload {
  generatedAt?: string;
  rows?: TurkeyRowWire[];
  wholeHenRows?: TurkeyRowWire[];
  breastRows?: TurkeyRowWire[];
}

interface PorkRow {
  date: string;
  pork_carcass: number | null;
  pork_loin: number | null;
  pork_butt: number | null;
  pork_picnic: number | null;
  pork_rib: number | null;
  pork_ham: number | null;
  pork_belly: number | null;
}

interface PorkPayload {
  generatedAt?: string;
  rows: PorkRow[];
}

type PorkCutKey = "carcass" | "loin" | "butt" | "picnic" | "rib" | "ham" | "belly";

interface PorkComprehensiveRow {
  date: string;
  carcass: number | null;
  loin: number | null;
  butt: number | null;
  picnic: number | null;
  rib: number | null;
  ham: number | null;
  belly: number | null;
  synthesized?: boolean;
}

interface PorkComprehensivePayload {
  generatedAt?: string;
  rows: (PorkComprehensiveRow & { report_for_date?: string; report_date?: string })[];
}

type Condition = "all" | "Fresh" | "Frozen";
/** Table row order: oldest date at top, or newest at top. */
type TableDateOrder = "asc" | "desc";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toIso(mmddyyyy: string) {
  const [m, dd, y] = mmddyyyy.split("/");
  return `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function asNumberOrNull(v: unknown) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number | null | undefined) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

function fmtVolume(v: number | null | undefined) {
  if (v == null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatUpdatedEn(raw?: string) {
  if (!raw) return null;
  const s = raw.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(/T\d/.test(s) ? { timeStyle: "short" } : {}),
  } as Intl.DateTimeFormatOptions).format(d);
}

const HOG_LINE = {
  national: "#7c2d12",
  iowaMn: "#b45309",
  western: "#d97706",
};

function mergeHogByDate(prev: HogRow[], incoming: HogRow[]): HogRow[] {
  const map = new Map<string, HogRow>();
  for (const r of prev) map.set(r.date, r);
  for (const r of incoming) map.set(r.date, r);
  return [...map.keys()].sort().map((d) => map.get(d)!);
}

function turkeyRowKey(r: TurkeyRow) {
  return [
    r.isoDate,
    r.week_end,
    r.condition,
    r.low_price ?? "",
    r.high_price ?? "",
    r.wtd_avg ?? "",
    r.volume_1000_lbs ?? "",
  ].join("\0");
}

function compareNullableNumber(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareTurkeyRows(a: TurkeyRow, b: TurkeyRow) {
  return (
    a.isoDate.localeCompare(b.isoDate) ||
    a.condition.localeCompare(b.condition) ||
    compareNullableNumber(a.low_price, b.low_price) ||
    compareNullableNumber(a.high_price, b.high_price) ||
    compareNullableNumber(a.wtd_avg, b.wtd_avg) ||
    compareNullableNumber(a.volume_1000_lbs, b.volume_1000_lbs)
  );
}

function normalizeTurkeyRow(r: TurkeyRowWire): TurkeyRow {
  return {
    week_start: r.week_start,
    week_end: r.week_end,
    condition: r.condition,
    low_price: asNumberOrNull(r.low_price),
    high_price: asNumberOrNull(r.high_price),
    wtd_avg: asNumberOrNull(r.wtd_avg),
    volume_1000_lbs: asNumberOrNull(r.volume_1000_lbs ?? r.volume_lbs),
    isoDate: toIso(r.week_start),
  };
}

function mergeTurkeyRows(prev: TurkeyRow[], incoming: TurkeyRowWire[]): TurkeyRow[] {
  const mapped = incoming.map(normalizeTurkeyRow);
  const map = new Map<string, TurkeyRow>();
  for (const r of prev) map.set(turkeyRowKey(r), r);
  for (const r of mapped) map.set(turkeyRowKey(r), r);
  return [...map.values()].sort(compareTurkeyRows);
}

function parseTurkeyPayload(payload: TurkeyPayload) {
  if (Array.isArray(payload.wholeHenRows) || Array.isArray(payload.breastRows)) {
    return {
      wholeHenRows: mergeTurkeyRows([], payload.wholeHenRows ?? []),
      breastRows: mergeTurkeyRows([], payload.breastRows ?? []),
      /*
      "pork-comprehensive": `Fetching weekly comprehensive pork prices from USDA for ${startDate} â†’ ${endDate}â€¦`,
      */
    };
  }

  const legacyRows = payload.rows ?? [];
  const breastRows: TurkeyRowWire[] = legacyRows
    .filter((r) => asNumberOrNull(r.breast_wtd_avg) != null)
    .map((r) => ({
      week_start: r.week_start,
      week_end: r.week_end,
      condition: r.condition,
      low_price: null,
      high_price: null,
      wtd_avg: asNumberOrNull(r.breast_wtd_avg),
      volume_1000_lbs: null,
    }));

  return {
    wholeHenRows: mergeTurkeyRows([], legacyRows),
    breastRows: mergeTurkeyRows([], breastRows),
  };
}

function filterTurkeyRows(rows: TurkeyRow[], start: string, end: string, cond: Condition) {
  if (!start || !end || start > end) return [];
  return rows
    .filter((r) => r.isoDate >= start && r.isoDate <= end)
    .filter((r) => cond === "all" || r.condition === cond)
    .sort(compareTurkeyRows);
}

interface TurkeySeriesPoint {
  isoDate: string;
  week_start: string;
  condition: Exclude<Condition, "all">;
  wtd_avg: number | null;
  volume_1000_lbs: number | null;
}

function summarizeTurkeySeries(rows: TurkeyRow[]): TurkeySeriesPoint[] {
  const buckets = new Map<string, TurkeyRow[]>();
  for (const row of rows) {
    const key = `${row.isoDate}\0${row.condition}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const first = bucket[0];
      const priced = bucket.filter((row) => row.wtd_avg != null);
      const totalVolume = bucket.reduce(
        (sum, row) => sum + (row.volume_1000_lbs != null ? row.volume_1000_lbs : 0),
        0
      );
      const canWeight =
        priced.length > 0 && priced.every((row) => row.volume_1000_lbs != null && row.volume_1000_lbs > 0);
      const wtd_avg =
        priced.length === 0
          ? null
          : canWeight
            ? priced.reduce(
                (sum, row) => sum + (row.wtd_avg ?? 0) * (row.volume_1000_lbs ?? 0),
                0
              ) / totalVolume
            : priced.reduce((sum, row) => sum + (row.wtd_avg ?? 0), 0) / priced.length;

      return {
        isoDate: first.isoDate,
        week_start: first.week_start,
        condition: first.condition as Exclude<Condition, "all">,
        wtd_avg,
        volume_1000_lbs: totalVolume > 0 ? totalVolume : null,
      };
    })
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.condition.localeCompare(b.condition));
}

const TURKEY_LINE = { Fresh: "#92400e", Frozen: "#451a03", BreastFresh: "#c2410c", BreastFrozen: "#7c2d12" };

const PORK_CUT_COLORS: Record<PorkCutKey, string> = {
  carcass: "#b91c1c",
  loin: "#d97706",
  butt: "#16a34a",
  picnic: "#0891b2",
  rib: "#7c3aed",
  ham: "#db2777",
  belly: "#ea580c",
};

const PORK_FIELD_LABELS: Record<PorkCutKey, string> = {
  carcass: "Carcass",
  loin: "Loin",
  butt: "Butt",
  picnic: "Picnic",
  rib: "Rib",
  ham: "Ham",
  belly: "Belly",
};

const PORK_NEGOTIATED_FIELD_KEYS: Record<PorkCutKey, keyof PorkRow> = {
  carcass: "pork_carcass",
  loin: "pork_loin",
  butt: "pork_butt",
  picnic: "pork_picnic",
  rib: "pork_rib",
  ham: "pork_ham",
  belly: "pork_belly",
};

const PORK_NEGOTIATED_LINE = {
  pork_carcass: PORK_CUT_COLORS.carcass,
  pork_loin: PORK_CUT_COLORS.loin,
  pork_butt: PORK_CUT_COLORS.butt,
  pork_picnic: PORK_CUT_COLORS.picnic,
  pork_rib: PORK_CUT_COLORS.rib,
  pork_ham: PORK_CUT_COLORS.ham,
  pork_belly: PORK_CUT_COLORS.belly,
};

function normalizePorkComprehensiveRow(
  row: PorkComprehensiveRow & { report_for_date?: string; report_date?: string }
): PorkComprehensiveRow | null {
  const date = row.date ?? row.report_for_date;
  if (!date) return null;
  return {
    date,
    carcass: row.carcass ?? null,
    loin: row.loin ?? null,
    butt: row.butt ?? null,
    picnic: row.picnic ?? null,
    rib: row.rib ?? null,
    ham: row.ham ?? null,
    belly: row.belly ?? null,
    synthesized: row.synthesized === true ? true : undefined,
  };
}

function mergePorkComprehensiveRows(
  prev: PorkComprehensiveRow[],
  incoming: (PorkComprehensiveRow & { report_for_date?: string; report_date?: string })[]
) {
  const map = new Map<string, PorkComprehensiveRow>();
  for (const row of prev) map.set(row.date, row);
  for (const row of incoming) {
    const normalized = normalizePorkComprehensiveRow(row);
    if (!normalized) continue;
    map.set(normalized.date, normalized);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function toWeekEndingFriday(dateIso: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? -2 : weekday === 6 ? -1 : 5 - weekday;
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getPorkNegotiatedCutValue(row: PorkRow, cut: PorkCutKey): number | null {
  return row[PORK_NEGOTIATED_FIELD_KEYS[cut]] as number | null;
}

function buildWeeklyNegotiatedPork(rows: PorkRow[]): PorkComprehensiveRow[] {
  const buckets = new Map<
    string,
    {
      sums: Record<PorkCutKey, number>;
      counts: Record<PorkCutKey, number>;
    }
  >();

  for (const row of rows) {
    const weekEnding = toWeekEndingFriday(row.date);
    const bucket =
      buckets.get(weekEnding) ??
      {
        sums: { carcass: 0, loin: 0, butt: 0, picnic: 0, rib: 0, ham: 0, belly: 0 },
        counts: { carcass: 0, loin: 0, butt: 0, picnic: 0, rib: 0, ham: 0, belly: 0 },
      };

    (Object.keys(PORK_FIELD_LABELS) as PorkCutKey[]).forEach((cut) => {
      const value = getPorkNegotiatedCutValue(row, cut);
      if (value == null) return;
      bucket.sums[cut] += value;
      bucket.counts[cut] += 1;
    });

    buckets.set(weekEnding, bucket);
  }

  return [...buckets.entries()]
    .map(([weekEnding, bucket]) => ({
      date: weekEnding,
      carcass: bucket.counts.carcass ? bucket.sums.carcass / bucket.counts.carcass : null,
      loin: bucket.counts.loin ? bucket.sums.loin / bucket.counts.loin : null,
      butt: bucket.counts.butt ? bucket.sums.butt / bucket.counts.butt : null,
      picnic: bucket.counts.picnic ? bucket.sums.picnic / bucket.counts.picnic : null,
      rib: bucket.counts.rib ? bucket.sums.rib / bucket.counts.rib : null,
      ham: bucket.counts.ham ? bucket.sums.ham / bucket.counts.ham : null,
      belly: bucket.counts.belly ? bucket.sums.belly / bucket.counts.belly : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const EMPTY_DATA_HINT =
  "No data loaded yet. Set a date range and press Refresh to fetch from USDA.";

const ADMIN_TAB_HINT =
  "Run the background job below to rebuild the saved JSON files. Progress and the follow-up reload appear here.";

function exportHog(rows: HogRow[]) {
  import("xlsx").then((XLSX) => {
    const data = [
      ["Date", "National (Neg. Carcass)", "Iowa/MN (Neg. Carcass)", "W. Cornbelt (Neg. Carcass)"],
      ...rows.map((r) => [r.date, r.national, r.iowaMn, r.western]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 26 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "LM_HG217");
    const from = rows[0]?.date ?? "start";
    const to = rows[rows.length - 1]?.date ?? "end";
    XLSX.writeFile(wb, `LM_HG217_${from}_${to}.xlsx`);
  });
}

function exportPork(rows: PorkRow[]) {
  import("xlsx").then((XLSX) => {
    const data = [
      ["Date", "Carcass", "Loin", "Butt", "Picnic", "Rib", "Ham", "Belly"],
      ...rows.map((r) => [r.date, r.pork_carcass, r.pork_loin, r.pork_butt, r.pork_picnic, r.pork_rib, r.pork_ham, r.pork_belly]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, ...Array(7).fill({ wch: 10 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "LM_PK602");
    const from = rows[0]?.date ?? "start";
    const to = rows[rows.length - 1]?.date ?? "end";
    XLSX.writeFile(wb, `LM_PK602_${from}_${to}.xlsx`);
  });
}

function exportPorkComprehensive(rows: PorkComprehensiveRow[]) {
  import("xlsx").then((XLSX) => {
    const data = [
      ["Date", "Carcass", "Loin", "Butt", "Picnic", "Rib", "Ham", "Belly"],
      ...rows.map((r) => [r.date, r.carcass, r.loin, r.butt, r.picnic, r.rib, r.ham, r.belly]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, ...Array(7).fill({ wch: 10 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "LM_PK680");
    const from = rows[0]?.date ?? "start";
    const to = rows[rows.length - 1]?.date ?? "end";
    XLSX.writeFile(wb, `LM_PK680_${from}_${to}.xlsx`);
  });
}

function exportTurkey(rows: TurkeyRow[]) {
  import("xlsx").then((XLSX) => {
    const data = [
      [
        "Week Start",
        "Week End",
        "WEEKLY DATA TURKEY BREASTS FRESH Wtd Avg (¢/lb)",
        "Volume (1,000 lbs)",
      ],
      ...rows.map((r) => [
        r.week_start,
        r.week_end,
        r.wtd_avg,
        r.volume_1000_lbs,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 34 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Turkey Breast Fresh");
    const from = rows[0]?.week_start ?? "start";
    const to = rows[rows.length - 1]?.week_start ?? "end";
    XLSX.writeFile(wb, `Turkey_Breast_BS_Tom_Fresh_${from}_${to}.xlsx`);
  });
}

export default function MarketDashboard({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(initialTab);

  const [startDate, setStartDate] = useState("2019-01-01");
  const [endDate, setEndDate] = useState(todayIso());

  const [hogFull, setHogFull] = useState<HogRow[]>([]);
  const [hogRows, setHogRows] = useState<HogRow[]>([]);
  const [hogMeta, setHogMeta] = useState<string | undefined>();

  const [turkeyFull, setTurkeyFull] = useState<TurkeyRow[]>([]);
  const [turkeyRows, setTurkeyRows] = useState<TurkeyRow[]>([]);
  const [turkeyBreastFull, setTurkeyBreastFull] = useState<TurkeyRow[]>([]);
  const [turkeyBreastRows, setTurkeyBreastRows] = useState<TurkeyRow[]>([]);
  const [turkeyMeta, setTurkeyMeta] = useState<string | undefined>();
  const [condition, setCondition] = useState<Condition>("all");
  const [tableDateOrder, setTableDateOrder] = useState<TableDateOrder>("desc");

  const [porkFull, setPorkFull] = useState<PorkRow[]>([]);
  const [porkRows, setPorkRows] = useState<PorkRow[]>([]);
  const [porkMeta, setPorkMeta] = useState<string | undefined>();
  const [porkComprehensiveFull, setPorkComprehensiveFull] = useState<PorkComprehensiveRow[]>([]);
  const [porkComprehensiveRows, setPorkComprehensiveRows] = useState<PorkComprehensiveRow[]>([]);
  const [porkComprehensiveMeta, setPorkComprehensiveMeta] = useState<string | undefined>();
  const [porkComparisonCut, setPorkComparisonCut] = useState<PorkCutKey>("carcass");

  const [status, setStatus] = useState(() => (initialTab === "admin" ? ADMIN_TAB_HINT : EMPTY_DATA_HINT));
  const [fetchingRange, setFetchingRange] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const [hogFetchLog, setHogFetchLog] = useState<HogRefreshLogRow[]>([]);
  const [porkFetchLog, setPorkFetchLog] = useState<PorkRefreshLogRow[]>([]);
  const [turkeyFetchLog, setTurkeyFetchLog] = useState<TurkeyRefreshLogRow[]>([]);
  const [showHogLog, setShowHogLog] = useState(true);
  const [showTurkeyLog, setShowTurkeyLog] = useState(true);
  const [showPorkLog, setShowPorkLog] = useState(true);
  const hogLogScrollRef = useRef<HTMLDivElement>(null);
  const turkeyLogScrollRef = useRef<HTMLDivElement>(null);
  const porkLogScrollRef = useRef<HTMLDivElement>(null);
  /** When true, new log lines auto-scroll to bottom; false if user scrolled up. */
  const hogLogStickBottomRef = useRef(true);
  const turkeyLogStickBottomRef = useRef(true);
  const porkLogStickBottomRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Invalidate in-flight hog USDA responses when a newer hog request starts. */
  const hogPullGenRef = useRef(0);
  const porkPullGenRef = useRef(0);
  const porkComprehensivePullGenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = hogLogScrollRef.current;
    if (!el || !hogLogStickBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [hogFetchLog, fetchingRange]);

  useLayoutEffect(() => {
    const el = turkeyLogScrollRef.current;
    if (!el || !turkeyLogStickBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [turkeyFetchLog, fetchingRange]);

  useLayoutEffect(() => {
    const el = porkLogScrollRef.current;
    if (!el || !porkLogStickBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [porkFetchLog, fetchingRange]);

  const syncTabToUrl = useCallback(
    (t: Tab) => {
      const q = new URLSearchParams(searchParams?.toString() ?? "");
      if (t === "turkey") q.set("tab", "turkey");
      else if (t === "admin") q.set("tab", "admin");
      else if (t === "pork") q.set("tab", "pork");
      else if (t === "pork-comprehensive") q.set("tab", "pork-comprehensive");
      else q.delete("tab");
      const s = q.toString();
      router.replace(s ? `/?${s}` : "/", { scroll: false });
    },
    [router, searchParams]
  );

  const loadHog = useCallback(async (bust: boolean) => {
    const res = await fetch(HOG_URL, { cache: bust ? "no-store" : "default" });
    if (!res.ok) throw new Error(`Hog data HTTP ${res.status}`);
    const payload: HogPayload = await res.json();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    setHogFull(rows);
    setHogMeta(payload.generatedAt);
    return rows;
  }, []);

  const loadTurkey = useCallback(async (bust: boolean) => {
    const res = await fetch(TURKEY_URL, { cache: bust ? "no-store" : "default" });
    if (!res.ok) throw new Error(`Turkey data HTTP ${res.status}`);
    const payload: TurkeyPayload = await res.json();
    const parsed = parseTurkeyPayload(payload);
    setTurkeyFull(parsed.wholeHenRows);
    setTurkeyBreastFull(parsed.breastRows);
    setTurkeyMeta(payload.generatedAt);
    return parsed;
  }, []);

  const loadPork = useCallback(async (bust: boolean) => {
    const res = await fetch(PORK_URL, { cache: bust ? "no-store" : "default" });
    if (!res.ok) throw new Error(`Pork data HTTP ${res.status}`);
    const payload: PorkPayload = await res.json();
    const rows = Array.isArray(payload) ? (payload as PorkRow[]) : (payload.rows ?? []);
    setPorkFull(rows);
    setPorkMeta((payload as PorkPayload).generatedAt);
    return rows;
  }, []);

  const loadPorkComprehensive = useCallback(async (_bust: boolean) => {
    const res = await fetch(PORK_COMPREHENSIVE_URL, { cache: "no-store" });
    if (res.status === 404) {
      setPorkComprehensiveFull([]);
      setPorkComprehensiveMeta(undefined);
      return [];
    }
    if (!res.ok) throw new Error(`Comprehensive pork data HTTP ${res.status}`);
    const payload: PorkComprehensivePayload = await res.json();
    const rows = Array.isArray(payload) ? (payload as unknown as PorkComprehensiveRow[]) : (payload.rows ?? []);
    const mergedRows = mergePorkComprehensiveRows([], rows);
    setPorkComprehensiveFull(mergedRows);
    setPorkComprehensiveMeta((payload as PorkComprehensivePayload).generatedAt);
    return mergedRows;
  }, []);

  /* Load all static JSONs once on mount so every tab shows data immediately */
  useEffect(() => {
    void Promise.all([
      loadHog(false),
      loadTurkey(false),
      loadPork(false),
      loadPorkComprehensive(false),
    ]).catch(() => {});
  }, [loadHog, loadTurkey, loadPork, loadPorkComprehensive]);

  const filterHog = useCallback(
    (rows: HogRow[], start: string, end: string) => {
      if (!start || !end || start > end) {
        setHogRows([]);
        return;
      }
      const filtered = rows
        .filter((r) => r.date >= start && r.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date));
      setHogRows(filtered);
    },
    []
  );

  const filterTurkey = useCallback(
    (wholeHenRows: TurkeyRow[], breastRows: TurkeyRow[], start: string, end: string, cond: Condition) => {
      setTurkeyRows(filterTurkeyRows(wholeHenRows, start, end, cond));
      setTurkeyBreastRows(filterTurkeyRows(breastRows, start, end, cond));
    },
    []
  );

  const filterPork = useCallback(
    (rows: PorkRow[], start: string, end: string) => {
      if (!start || !end || start > end) {
        setPorkRows([]);
        return;
      }
      const filtered = rows
        .filter((r) => r.date >= start && r.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date));
      setPorkRows(filtered);
    },
    []
  );

  const filterPorkComprehensive = useCallback(
    (rows: PorkComprehensiveRow[], start: string, end: string) => {
      if (!start || !end || start > end) {
        setPorkComprehensiveRows([]);
        return;
      }
      const filtered = rows
        .filter((r) => r.date >= start && r.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date));
      setPorkComprehensiveRows(filtered);
    },
    []
  );

  /* Apply filters when dates / full data / condition change (debounced for date inputs) */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const invalidRange = !startDate || !endDate || startDate > endDate;
      const noLoadedData = !hogFull.length && !turkeyFull.length && !porkFull.length && !porkComprehensiveFull.length;

      filterHog(hogFull, startDate, endDate);
      filterTurkey(turkeyFull, turkeyBreastFull, startDate, endDate, condition);
      filterPork(porkFull, startDate, endDate);
      filterPorkComprehensive(porkComprehensiveFull, startDate, endDate);

      if (tab === "admin") return;

      if (noLoadedData) {
        setStatus(invalidRange ? "Choose a valid date range (start ≤ end)." : EMPTY_DATA_HINT);
        return;
      }

      if (invalidRange) {
        setStatus("Choose a valid date range (start ≤ end).");
        return;
      }

      const n =
        tab === "hog"
          ? hogFull.filter((r) => r.date >= startDate && r.date <= endDate).length
          : tab === "pork"
            ? porkFull.filter((r) => r.date >= startDate && r.date <= endDate).length
            : tab === "pork-comprehensive"
              ? porkComprehensiveFull.filter((r) => r.date >= startDate && r.date <= endDate).length
              : filterTurkeyRows(turkeyFull, startDate, endDate, condition).length;
      setStatus(
        n > 0
          ? `${n} ${tab === "hog" || tab === "pork" ? "trading days" : "rows"} in range ${startDate} → ${endDate}`
          : "No rows in this range for the current tab."
      );
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    startDate,
    endDate,
    hogFull,
    turkeyFull,
    turkeyBreastFull,
    porkFull,
    porkComprehensiveFull,
    condition,
    filterHog,
    filterTurkey,
    filterPork,
    filterPorkComprehensive,
    tab,
  ]);

  const reloadDeployedJson = useCallback(async () => {
    const [h, t, p, pc] = await Promise.all([
      loadHog(true),
      loadTurkey(true),
      loadPork(true),
      loadPorkComprehensive(true),
    ]);
    filterHog(h, startDate, endDate);
    filterTurkey(t.wholeHenRows, t.breastRows, startDate, endDate, condition);
    filterPork(p, startDate, endDate);
    filterPorkComprehensive(pc, startDate, endDate);
    const nHog = h.filter((r) => r.date >= startDate && r.date <= endDate).length;
    const nTurkey = filterTurkeyRows(t.wholeHenRows, startDate, endDate, condition).length;
    const nPork = p.filter((r) => r.date >= startDate && r.date <= endDate).length;
    const nPorkComprehensive = pc.filter((r) => r.date >= startDate && r.date <= endDate).length;
    return { nHog, nTurkey, nPork, nPorkComprehensive };
  }, [
    loadHog,
    loadTurkey,
    loadPork,
    loadPorkComprehensive,
    filterHog,
    filterTurkey,
    filterPork,
    filterPorkComprehensive,
    startDate,
    endDate,
    condition,
  ]);

  const ensureSessionDataLoaded = useCallback(async () => {
    const [h, t, p, pc] = await Promise.all([
      hogFull.length ? Promise.resolve(hogFull) : loadHog(false),
      turkeyFull.length || turkeyBreastFull.length
        ? Promise.resolve({ wholeHenRows: turkeyFull, breastRows: turkeyBreastFull })
        : loadTurkey(false),
      porkFull.length ? Promise.resolve(porkFull) : loadPork(false),
      porkComprehensiveFull.length ? Promise.resolve(porkComprehensiveFull) : loadPorkComprehensive(false),
    ]);
    filterHog(h, startDate, endDate);
    filterTurkey(t.wholeHenRows, t.breastRows, startDate, endDate, condition);
    filterPork(p, startDate, endDate);
    filterPorkComprehensive(pc, startDate, endDate);
    return {
      nHog: h.filter((r) => r.date >= startDate && r.date <= endDate).length,
      nTurkey: filterTurkeyRows(t.wholeHenRows, startDate, endDate, condition).length,
      nPork: p.filter((r) => r.date >= startDate && r.date <= endDate).length,
      nPorkComprehensive: pc.filter((r) => r.date >= startDate && r.date <= endDate).length,
    };
  }, [
    hogFull,
    turkeyFull,
    turkeyBreastFull,
    porkFull,
    porkComprehensiveFull,
    loadHog,
    loadTurkey,
    loadPork,
    loadPorkComprehensive,
    filterHog,
    filterTurkey,
    filterPork,
    filterPorkComprehensive,
    startDate,
    endDate,
    condition,
  ]);

  const pullUsdaRange = useCallback(
    async (apiTab: "hog" | "turkey" | "pork" | "pork-comprehensive", start: string, end: string, introStatus: string) => {
      if (!start || !end || start > end) {
        setStatus("Choose a valid date range (start ≤ end).");
        return;
      }
      const myGen =
        apiTab === "hog"
          ? ++hogPullGenRef.current
          : apiTab === "pork"
            ? ++porkPullGenRef.current
            : apiTab === "pork-comprehensive"
              ? ++porkComprehensivePullGenRef.current
              : 0;
      setFetchingRange(true);
      try {
        setStatus(introStatus);

        if (apiTab === "hog") {
          hogLogStickBottomRef.current = true;
          setHogFetchLog([]);
          const res = await fetch(
            `/api/fetch-hog-stream?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
          );
          if (!res.ok) {
            const text = await res.text();
            let msg = text;
            try {
              const j = JSON.parse(text) as { error?: string };
              if (j.error) msg = j.error;
            } catch {
              /* use raw */
            }
            throw new Error(msg || `HTTP ${res.status}`);
          }
          if (!res.body) throw new Error("Empty response body");

          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          let finalRows: HogRow[] | undefined;
          let finalGeneratedAt: string | undefined;

          const handleLine = (line: string) => {
            if (!line.trim()) return;
            let evt: HogStreamEvent;
            try {
              evt = JSON.parse(line) as HogStreamEvent;
            } catch {
              return;
            }
            if (evt.type === "log") {
              if (myGen !== hogPullGenRef.current) return;
              setHogFetchLog((prev) => [...prev, { t: evt.t, message: evt.message }]);
            } else if (evt.type === "done") {
              finalRows = evt.rows;
              finalGeneratedAt = evt.generatedAt;
            } else if (evt.type === "error") {
              throw new Error(evt.error || "Stream error");
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              handleLine(line);
            }
          }
          if (buffer.trim()) {
            handleLine(buffer.trim());
          }

          if (myGen !== hogPullGenRef.current) return;
          if (!finalRows) throw new Error("Stream ended without data");
          const mergedRows = finalRows;

          setHogFull((prev) => mergeHogByDate(prev, mergedRows));
          if (finalGeneratedAt) setHogMeta(finalGeneratedAt);

          const count = mergedRows.length;
          if (myGen !== hogPullGenRef.current) return;
          setStatus(
            count > 0
              ? `Loaded ${count} row(s) from USDA for ${start} → ${end}.`
              : `USDA returned no rows for that range — try different dates.`
          );
          return;
        }

        if (apiTab === "pork") {
          porkLogStickBottomRef.current = true;
          setPorkFull([]);
          setPorkRows([]);
          setPorkFetchLog([]);

          const res = await fetch(
            `/api/fetch-pork-stream?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
            { cache: "no-store" }
          );
          if (!res.ok) {
            const text = await res.text();
            let msg = text;
            try {
              const j = JSON.parse(text) as { error?: string };
              if (j.error) msg = j.error;
            } catch {
              /* use raw */
            }
            throw new Error(msg || `HTTP ${res.status}`);
          }
          if (!res.body) throw new Error("Empty response body");

          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          let finalRows: PorkRow[] | undefined;
          let finalGeneratedAt: string | undefined;

          const handleLine = (line: string) => {
            if (!line.trim()) return;
            let evt: PorkStreamEvent;
            try {
              evt = JSON.parse(line) as PorkStreamEvent;
            } catch {
              return;
            }
            if (evt.type === "log") {
              if (myGen !== porkPullGenRef.current) return;
              setPorkFetchLog((prev) => [...prev, { t: evt.t, message: evt.message }]);
            } else if (evt.type === "done") {
              finalRows = evt.rows;
              finalGeneratedAt = evt.generatedAt;
            } else if (evt.type === "error") {
              throw new Error(evt.error || "Stream error");
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              handleLine(line);
            }
          }
          if (buffer.trim()) {
            handleLine(buffer.trim());
          }

          if (myGen !== porkPullGenRef.current) return;
          if (!finalRows) throw new Error("Stream ended without data");
          setPorkFull([...finalRows].sort((a, b) => a.date.localeCompare(b.date)));
          if (finalGeneratedAt) setPorkMeta(finalGeneratedAt);

          const count = finalRows.length;
          setStatus(
            count > 0
              ? `Loaded ${count} row(s) from USDA for ${start} → ${end}.`
              : `USDA returned no rows for that range — try different dates.`
          );
          return;
        }

        if (apiTab === "pork-comprehensive") {
          setPorkComprehensiveFull([]);
          setPorkComprehensiveRows([]);

          const [compRes, negotiatedRes] = await Promise.all([
            fetch(`/api/fetch-pork-comprehensive-range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
              cache: "no-store",
            }),
            fetch(`/api/fetch-range?tab=pork&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
              cache: "no-store",
            }),
          ]);

          const compData = (await compRes.json()) as {
            error?: string;
            rows?: PorkComprehensiveRow[];
            generatedAt?: string;
          };
          if (!compRes.ok) throw new Error(compData.error || `HTTP ${compRes.status}`);

          const negotiatedData = (await negotiatedRes.json()) as {
            error?: string;
            rows?: PorkRow[];
            generatedAt?: string;
          };
          if (!negotiatedRes.ok) throw new Error(negotiatedData.error || `HTTP ${negotiatedRes.status}`);

          if (myGen !== porkComprehensivePullGenRef.current) return;

          const comprehensiveRows = mergePorkComprehensiveRows([], compData.rows ?? []);
          const negotiatedRows = [...(negotiatedData.rows ?? [])].sort((a, b) => a.date.localeCompare(b.date));

          setPorkComprehensiveFull(comprehensiveRows);
          setPorkFull(negotiatedRows);
          if (compData.generatedAt) setPorkComprehensiveMeta(compData.generatedAt);
          if (negotiatedData.generatedAt) setPorkMeta(negotiatedData.generatedAt);

          setStatus(
            comprehensiveRows.length > 0 || negotiatedRows.length > 0
              ? `Loaded ${comprehensiveRows.length} weekly comprehensive row(s) and refreshed ${negotiatedRows.length} negotiated day(s) for ${start} â†’ ${end}.`
              : `USDA returned no rows for that range â€” try different dates.`
          );
          return;
        }

        if (apiTab === "turkey") {
          turkeyLogStickBottomRef.current = true;
          setTurkeyFetchLog([
            { t: new Date().toISOString(), message: `Start pull for ${start} -> ${end}` },
            { t: new Date().toISOString(), message: "Requesting /api/fetch-range?tab=turkey" },
          ]);
        }

        const res = await fetch(
          `/api/fetch-range?tab=${apiTab}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as {
          error?: string;
          rows?: TurkeyRowWire[];
          generatedAt?: string;
          tab?: string;
          wholeHenRows?: TurkeyRowWire[];
          breastRows?: TurkeyRowWire[];
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const parsed = parseTurkeyPayload(data);
        setTurkeyFull((prev) => mergeTurkeyRows(prev, parsed.wholeHenRows));
        setTurkeyBreastFull((prev) => mergeTurkeyRows(prev, parsed.breastRows));
        setTurkeyMeta(data.generatedAt);
        const wholeHenCount = parsed.wholeHenRows.length;
        const breastCount = parsed.breastRows.length;
        setTurkeyFetchLog((prev) => [
          ...prev,
          { t: new Date().toISOString(), message: "USDA response received" },
          {
            t: new Date().toISOString(),
            message: `Done: ${wholeHenCount} whole hen row(s), ${breastCount} breast row(s)`,
          },
        ]);
        setStatus(
          wholeHenCount + breastCount > 0
            ? `Loaded ${wholeHenCount} whole hen row(s) and ${breastCount} breast row(s) from USDA for ${start} → ${end}.`
            : `USDA returned no rows for that range — try different dates.`
        );
      } catch (e) {
        if (apiTab !== "hog" || myGen === hogPullGenRef.current) {
          setStatus(`Could not load fresh data: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (apiTab === "pork" && myGen === porkPullGenRef.current) {
          setPorkFetchLog((prev) => [
            ...prev,
            {
              t: new Date().toISOString(),
              message: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ]);
        }
        if (apiTab === "turkey") {
          setTurkeyFetchLog((prev) => [
            ...prev,
            {
              t: new Date().toISOString(),
              message: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ]);
        }
      } finally {
        if (mountedRef.current) setFetchingRange(false);
      }
    },
    []
  );

  async function fetchUsdaForRange() {
    if (tab !== "hog" && tab !== "turkey" && tab !== "pork" && tab !== "pork-comprehensive") return;
    const introMap: Record<"hog" | "turkey" | "pork" | "pork-comprehensive", string> = {
      hog: `Fetching daily hog prices from USDA for ${startDate} → ${endDate}…`,
      turkey: `Fetching weekly turkey prices from USDA for ${startDate} → ${endDate}…`,
      pork: `Fetching daily pork cutout prices from USDA for ${startDate} → ${endDate}…`,
      "pork-comprehensive": `Fetching weekly comprehensive pork prices from USDA for ${startDate} → ${endDate}…`,
    };
    await pullUsdaRange(tab, startDate, endDate, introMap[tab]);
  }

  async function syncRepoViaGithub() {
    const ok = window.confirm(
      "This starts a background job that updates the saved data files for this website (the numbers everyone sees when they open the page). It usually takes several minutes. Only continue if you help run this site. Continue?"
    );
    if (!ok) return;

    setGithubBusy(true);
    let workflowFinished = false;
    try {
      setStatus("Starting background update…");
      const res = await fetch("/api/trigger-refresh", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        pollSince?: string;
        message?: string;
        error?: string;
        hint?: string;
      };

      if (!res.ok) {
        const msg = [data.error, data.hint].filter(Boolean).join(" — ") || `Request failed (${res.status})`;
        setStatus(msg);
        return;
      }

      const pollSince = data.pollSince;
      if (!pollSince) {
        setStatus("The update was started, but status tracking was not available. Try reloading the page in a few minutes.");
        return;
      }

      setStatus(data.message ?? "Update started. Waiting for it to finish…");

      const intervalMs = 4000;
      const maxAttempts = 150;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (!mountedRef.current) return;

        const stRes = await fetch(`/api/workflow-status?since=${encodeURIComponent(pollSince)}`);
        const st = (await stRes.json()) as {
          error?: string;
          found?: boolean;
          phase?: string;
          label?: string;
          conclusion?: string | null;
          html_url?: string;
        };

        if (!stRes.ok) {
          setStatus(st.error ?? `Status check failed (${stRes.status}).`);
          break;
        }

        if (st.label && mountedRef.current) setStatus(st.label);

        if (st.found && st.phase === "done") {
          workflowFinished = true;
          if (st.conclusion === "success") {
            if (!mountedRef.current) return;
            setStatus("Update finished. Loading the latest saved data…");
            try {
              const { nHog, nTurkey, nPork, nPorkComprehensive } = await reloadDeployedJson();
              if (!mountedRef.current) return;
              setStatus(
                nHog + nTurkey + nPork + nPorkComprehensive > 0
                  ? `Saved data refreshed (${startDate} → ${endDate}): ${nHog} hog day(s), ${nTurkey} turkey row(s), ${nPork} pork day(s) in range.`
                  : "Saved data refreshed — no rows in your current date range. Try widening dates."
              );
            } catch (e) {
              if (!mountedRef.current) return;
              setStatus(
                `The update finished, but loading data failed: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          } else {
            const link = st.html_url ? ` Details: ${st.html_url}` : "";
            setStatus(`The background update did not succeed.${link}`);
          }
          break;
        }
      }

      if (!workflowFinished && mountedRef.current) {
        setStatus(
          "The background job is taking longer than expected. Wait a few minutes, reload this page, or ask the site maintainer to check the job status."
        );
      }
    } catch (e) {
      if (mountedRef.current) {
        setStatus(`Background update failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (mountedRef.current) setGithubBusy(false);
    }
  }

  function selectTab(t: Tab) {
    setTab(t);
    syncTabToUrl(t);
    if (t === "admin" && !githubBusy && !fetchingRange) {
      setStatus("Loading session datasets for admin view…");
      void ensureSessionDataLoaded()
        .then(({ nHog, nTurkey, nPork }) => {
          if (!mountedRef.current) return;
          setStatus(
            `Admin view ready (${startDate} → ${endDate}): ${nHog} hog day(s), ${nTurkey} turkey row(s), ${nPork} pork day(s).`
          );
        })
        .catch((e) => {
          if (!mountedRef.current) return;
          setStatus(`Could not load session data for admin view: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
  }

  const hogRowsChrono = useMemo(
    () => [...hogRows].sort((a, b) => a.date.localeCompare(b.date)),
    [hogRows]
  );

  const hogRowsForTable = useMemo(() => {
    const s = [...hogRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [hogRowsChrono, tableDateOrder]);

  const hogLast = hogRowsChrono[hogRowsChrono.length - 1];

  const porkRowsChrono = useMemo(
    () => [...porkRows].sort((a, b) => a.date.localeCompare(b.date)),
    [porkRows]
  );

  const porkRowsForTable = useMemo(() => {
    const s = [...porkRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [porkRowsChrono, tableDateOrder]);

  const porkLast = porkRowsChrono[porkRowsChrono.length - 1];

  const porkComprehensiveRowsChrono = useMemo(
    () => [...porkComprehensiveRows].sort((a, b) => a.date.localeCompare(b.date)),
    [porkComprehensiveRows]
  );

  const porkComprehensiveRowsForTable = useMemo(() => {
    const s = [...porkComprehensiveRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [porkComprehensiveRowsChrono, tableDateOrder]);

  const porkComprehensiveLast = porkComprehensiveRowsChrono[porkComprehensiveRowsChrono.length - 1];
  const porkNegotiatedWeeklyRows = useMemo(() => buildWeeklyNegotiatedPork(porkRows), [porkRows]);
  const porkComparisonData = useMemo(() => {
    const chartMap = new Map<string, { date: string; negotiated?: number | null; comprehensive?: number | null; spread?: number | null }>();

    porkNegotiatedWeeklyRows.forEach((row) => {
      const value = row[porkComparisonCut];
      const entry = chartMap.get(row.date) ?? { date: row.date };
      entry.negotiated = value;
      chartMap.set(row.date, entry);
    });

    porkComprehensiveRowsChrono.forEach((row) => {
      const value = row[porkComparisonCut];
      const entry = chartMap.get(row.date) ?? { date: row.date };
      entry.comprehensive = value;
      chartMap.set(row.date, entry);
    });

    return [...chartMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        spread:
          row.comprehensive != null && row.negotiated != null
            ? row.comprehensive - row.negotiated
            : null,
      }));
  }, [porkNegotiatedWeeklyRows, porkComprehensiveRowsChrono, porkComparisonCut]);
  const porkComparisonLatest = porkComparisonData[porkComparisonData.length - 1];

  const turkeyRowsChrono = useMemo(
    () => [...turkeyRows].sort(compareTurkeyRows),
    [turkeyRows]
  );

  const turkeyRowsForTable = useMemo(() => {
    const s = [...turkeyRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [turkeyRowsChrono, tableDateOrder]);

  const turkeyBreastRowsChrono = useMemo(
    () => [...turkeyBreastRows].sort(compareTurkeyRows),
    [turkeyBreastRows]
  );

  const turkeyBreastRowsForTable = useMemo(() => {
    const s = [...turkeyBreastRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [turkeyBreastRowsChrono, tableDateOrder]);

  const turkeyBreastFreshRowsForTable = useMemo(() => {
    const s = filterTurkeyRows(turkeyBreastFull, startDate, endDate, "Fresh");
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [turkeyBreastFull, startDate, endDate, tableDateOrder]);

  const wholeHenSeries = useMemo(() => summarizeTurkeySeries(turkeyRows), [turkeyRows]);
  const breastSeries = useMemo(() => summarizeTurkeySeries(turkeyBreastRows), [turkeyBreastRows]);
  const wholeHenFreshSeries = wholeHenSeries.filter((r) => r.condition === "Fresh");
  const wholeHenFrozenSeries = wholeHenSeries.filter((r) => r.condition === "Frozen");
  const breastFreshSeries = breastSeries.filter((r) => r.condition === "Fresh");
  const breastFrozenSeries = breastSeries.filter((r) => r.condition === "Frozen");
  const latestWholeHenFresh = wholeHenFreshSeries[wholeHenFreshSeries.length - 1];
  const latestWholeHenFrozen = wholeHenFrozenSeries[wholeHenFrozenSeries.length - 1];
  const latestBreastFresh = breastFreshSeries[breastFreshSeries.length - 1];
  const latestBreastFrozen = breastFrozenSeries[breastFrozenSeries.length - 1];
  const thisYear = new Date().getFullYear().toString();
  const ytdFresh = wholeHenFreshSeries.filter((r) => r.isoDate.startsWith(thisYear));
  const avgFresh =
    ytdFresh.length > 0
      ? ytdFresh.reduce((sum, row) => sum + (row.wtd_avg ?? 0), 0) / ytdFresh.length
      : null;

  const chartData = useMemo(() => {
    const chartDataMap = new Map<
      string,
      { isoDate: string; Fresh?: number; Frozen?: number; BreastFresh?: number; BreastFrozen?: number }
    >();

    wholeHenSeries.forEach((row) => {
      const entry = chartDataMap.get(row.isoDate) ?? { isoDate: row.isoDate };
      if (row.condition === "Fresh" && row.wtd_avg != null) entry.Fresh = row.wtd_avg;
      if (row.condition === "Frozen" && row.wtd_avg != null) entry.Frozen = row.wtd_avg;
      chartDataMap.set(row.isoDate, entry);
    });

    breastSeries.forEach((row) => {
      const entry = chartDataMap.get(row.isoDate) ?? { isoDate: row.isoDate };
      if (row.condition === "Fresh" && row.wtd_avg != null) entry.BreastFresh = row.wtd_avg;
      if (row.condition === "Frozen" && row.wtd_avg != null) entry.BreastFrozen = row.wtd_avg;
      chartDataMap.set(row.isoDate, entry);
    });

    return Array.from(chartDataMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [wholeHenSeries, breastSeries]);

  return (
    <main className="shell">
      <header className="top-bar">
        <div className="tabs" role="tablist" aria-label="Primary navigation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "hog"}
            className={`tab-btn ${tab === "hog" ? "tab-btn--active" : ""}`}
            onClick={() => selectTab("hog")}
          >
            Daily hogs (LM_HG217)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "turkey"}
            className={`tab-btn ${tab === "turkey" ? "tab-btn--active" : ""}`}
            onClick={() => selectTab("turkey")}
          >
            Weekly turkey (AMS_3647)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pork"}
            className={`tab-btn ${tab === "pork" ? "tab-btn--active" : ""}`}
            onClick={() => selectTab("pork")}
          >
            Negotiated Pork (LM_PK602)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pork-comprehensive"}
            className={`tab-btn ${tab === "pork-comprehensive" ? "tab-btn--active" : ""}`}
            onClick={() => selectTab("pork-comprehensive")}
          >
            Comprehensive Pork (LM_PK680)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "admin"}
            className={`tab-btn ${tab === "admin" ? "tab-btn--active" : ""}`}
            onClick={() => selectTab("admin")}
          >
            Site admin
          </button>
        </div>
      </header>

      <header className="hero">
        {tab === "hog" ? (
          <>
            <p className="eyebrow">USDA MPR Datamart · negotiated carcass</p>
            <h1>Daily hog prices</h1>
            <p className="sub">National, Iowa/Minnesota, and Western Cornbelt — $/cwt. Reloading this page clears all data until you press Refresh.</p>
            {hogMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(hogMeta)}</p>}
          </>
        ) : tab === "turkey" ? (
          <>
            <p className="eyebrow">USDA MARS · whole young hen 8–16 lb, Grade A</p>
            <h1>Weekly turkey prices</h1>
            <p className="sub">Prices in cents per pound; frozen vs fresh. Reloading this page clears all data until you press Refresh.</p>
            {turkeyMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(turkeyMeta)}</p>}
          </>
        ) : tab === "pork" ? (
          <>
            <p className="eyebrow">USDA MPR Datamart · LM_PK602 negotiated carcass cutout</p>
            <h1>Daily negotiated pork cutout prices</h1>
            <p className="sub">Carcass, loin, butt, picnic, rib, ham, belly — $/cwt. Reloading this page clears all data until you press Refresh.</p>
            {porkMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(porkMeta)}</p>}
          </>
        ) : tab === "pork-comprehensive" ? (
          <>
            <p className="eyebrow">USDA MPR Datamart Â· LM_PK680 national weekly comprehensive pork report</p>
            <h1>Weekly comprehensive pork prices</h1>
            <p className="sub">Comprehensive values blend negotiated, contract, and formula transactions. Comparison charts align LM_PK680 with weekly averages derived from LM_PK602 daily negotiated prices.</p>
            {porkComprehensiveMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(porkComprehensiveMeta)}</p>}
          </>
        ) : (
          <>
            <p className="eyebrow">Administrators</p>
            <h1>Update saved site data</h1>
            <p className="sub">
            Triggers a background job (GitHub Actions) that rebuilds the JSON files under{" "}
            <code className="inline-code">/public/data/</code>. Status and loading the new files into this
            browser session stay on this tab. A full page reload still clears Hog/Turkey until Refresh is pressed there.
            </p>
          </>
        )}
      </header>

      {tab !== "admin" && (
        <section
          className={`panel controls ${tab === "hog" ? "controls--dashboard--hog" : "controls--dashboard"}`}
        >

          <div className="field">
            <label htmlFor="startDate">Start date</label>
            <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="endDate">End date</label>
            <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="field field--action">
            <label htmlFor="fetch-usda-btn">Refresh</label>
            <button
              id="fetch-usda-btn"
              type="button"
              className="btn-brown"
              onClick={() => void fetchUsdaForRange()}
              disabled={fetchingRange || githubBusy}
              title="Load the latest figures from USDA for the dates above (this browser tab only)."
            >
              {fetchingRange ? "Loading…" : "Refresh"}
            </button>
          </div>
          <button
            type="button"
            className="btn-brown btn-export-dash"
            onClick={() =>
              tab === "hog"
                ? exportHog(hogRowsForTable)
                : tab === "pork"
                  ? exportPork(porkRowsForTable)
                  : tab === "pork-comprehensive"
                    ? exportPorkComprehensive(porkComprehensiveRowsForTable)
                    : exportTurkey(turkeyBreastFreshRowsForTable)
            }
            disabled={
              tab === "hog"
                ? hogRows.length === 0
                : tab === "pork"
                  ? porkRows.length === 0
                  : tab === "pork-comprehensive"
                    ? porkComprehensiveRows.length === 0
                    : turkeyBreastFreshRowsForTable.length === 0
            }
          >
            Export Excel
          </button>
          <p className="status status--full">{status}</p>
          {tab === "hog" && (
            <div className="hog-fetch-log">
              <div className="table-wrap-head">
                <p className="hog-fetch-log__title">USDA hog pull log</p>
                <button type="button" className="btn-brown btn-brown--outline" onClick={() => setShowHogLog((s) => !s)}>
                  {showHogLog ? "Hide log" : "Show log"}
                </button>
              </div>
              {showHogLog && (
                <div
                  className="hog-fetch-log__scroll"
                  ref={hogLogScrollRef}
                  onScroll={(e) => {
                    const t = e.currentTarget;
                    hogLogStickBottomRef.current =
                      t.scrollHeight - t.scrollTop - t.clientHeight < 12;
                  }}
                >
                  <table className="hog-fetch-log__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hogFetchLog.length === 0 && !fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            No log yet — press Refresh to pull hog data.
                          </td>
                        </tr>
                      ) : hogFetchLog.length === 0 && fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            Connecting…
                          </td>
                        </tr>
                      ) : (
                        hogFetchLog.map((row, i) => (
                          <tr key={`${row.t}-${i}`}>
                            <td className="hog-fetch-log__num">{i + 1}</td>
                            <td className="hog-fetch-log__time">{formatLogTime(row.t)}</td>
                            <td className="hog-fetch-log__msg">{row.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {tab === "turkey" && (
            <div className="hog-fetch-log">
              <div className="table-wrap-head">
                <p className="hog-fetch-log__title">USDA turkey pull log</p>
                <button type="button" className="btn-brown btn-brown--outline" onClick={() => setShowTurkeyLog((s) => !s)}>
                  {showTurkeyLog ? "Hide log" : "Show log"}
                </button>
              </div>
              {showTurkeyLog && (
                <div
                  className="hog-fetch-log__scroll"
                  ref={turkeyLogScrollRef}
                  onScroll={(e) => {
                    const t = e.currentTarget;
                    turkeyLogStickBottomRef.current =
                      t.scrollHeight - t.scrollTop - t.clientHeight < 12;
                  }}
                >
                  <table className="hog-fetch-log__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {turkeyFetchLog.length === 0 && !fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            No log yet - press Refresh to pull turkey data.
                          </td>
                        </tr>
                      ) : turkeyFetchLog.length === 0 && fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            Connecting...
                          </td>
                        </tr>
                      ) : (
                        turkeyFetchLog.map((row, i) => (
                          <tr key={`${row.t}-${i}`}>
                            <td className="hog-fetch-log__num">{i + 1}</td>
                            <td className="hog-fetch-log__time">{formatLogTime(row.t)}</td>
                            <td className="hog-fetch-log__msg">{row.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {tab === "pork" && (
            <div className="hog-fetch-log">
              <div className="table-wrap-head">
                <p className="hog-fetch-log__title">USDA pork pull log</p>
                <button type="button" className="btn-brown btn-brown--outline" onClick={() => setShowPorkLog((s) => !s)}>
                  {showPorkLog ? "Hide log" : "Show log"}
                </button>
              </div>
              {showPorkLog && (
                <div
                  className="hog-fetch-log__scroll"
                  ref={porkLogScrollRef}
                  onScroll={(e) => {
                    const t = e.currentTarget;
                    porkLogStickBottomRef.current =
                      t.scrollHeight - t.scrollTop - t.clientHeight < 12;
                  }}
                >
                  <table className="hog-fetch-log__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porkFetchLog.length === 0 && !fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            No log yet - press Refresh to pull pork data.
                          </td>
                        </tr>
                      ) : porkFetchLog.length === 0 && fetchingRange ? (
                        <tr>
                          <td colSpan={3} className="hog-fetch-log__empty">
                            Connecting...
                          </td>
                        </tr>
                      ) : (
                        porkFetchLog.map((row, i) => (
                          <tr key={`${row.t}-${i}`}>
                            <td className="hog-fetch-log__num">{i + 1}</td>
                            <td className="hog-fetch-log__time">{formatLogTime(row.t)}</td>
                            <td className="hog-fetch-log__msg">{row.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "admin" && (
        <section className="panel admin-panel">
          <h2 className="admin-panel__title">Background refresh</h2>
          <p className="admin-panel__hint">
            For site maintainers only. This is not the Hog/Turkey/Pork Refresh control: it starts a long server-side
            job, then loads the new files into this open session so you can check Hog, Turkey, and Pork without another
            USDA pull.
          </p>
          <button
            id="server-refresh-btn"
            type="button"
            className="btn-brown btn-brown--outline"
            onClick={() => void syncRepoViaGithub()}
            disabled={fetchingRange || githubBusy}
            title="Administrative: refreshes shared data files on the host"
          >
            {githubBusy ? "Working…" : "Refresh saved data for all visitors"}
          </button>
          <p className="status status--full admin-panel__status">{status}</p>
        </section>
      )}

      {tab === "hog" && (
        <>
          <section className="panel metrics">
            <article>
              <h2>Latest national</h2>
              <p className="metric metric--brown1">{fmt(hogLast?.national)}</p>
            </article>
            <article>
              <h2>Latest Iowa/MN</h2>
              <p className="metric metric--brown2">{fmt(hogLast?.iowaMn)}</p>
            </article>
            <article>
              <h2>Latest W. Cornbelt</h2>
              <p className="metric metric--brown3">{fmt(hogLast?.western)}</p>
            </article>
            <article>
              <h2>Days in range</h2>
              <p className="metric metric--brown4">{hogRows.length}</p>
            </article>
          </section>

          <section className="panel table-wrap">
            <div className="table-wrap-head">
              <h2>Daily data</h2>
              <div className="field field--table-sort">
                <label htmlFor="tableDateOrder">Table order by date</label>
                <select
                  id="tableDateOrder"
                  className="select-brown select-brown--compact"
                  value={tableDateOrder}
                  onChange={(e) => setTableDateOrder(e.target.value as TableDateOrder)}
                >
                  <option value="asc">Oldest at top → newest down</option>
                  <option value="desc">Newest at top → oldest down</option>
                </select>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>National</th>
                    <th>Iowa/MN</th>
                    <th>W. Cornbelt</th>
                  </tr>
                </thead>
                <tbody>
                  {hogRowsForTable.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className={row.national != null ? "td-br1" : "val-null"}>{fmt(row.national)}</td>
                      <td className={row.iowaMn != null ? "td-br2" : "val-null"}>{fmt(row.iowaMn)}</td>
                      <td className={row.western != null ? "td-br3" : "val-null"}>{fmt(row.western)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel chart-wrap">
            <h2>Price trend</h2>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: HOG_LINE.national }} />
                National
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: HOG_LINE.iowaMn }} />
                Iowa/MN
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: HOG_LINE.western }} />
                Western Cornbelt
              </span>
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hogRowsChrono} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d5c4" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    tickFormatter={(v: string) => v.slice(0, 7)}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={44}
                  />
                  <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12 }} formatter={(v: number) => v?.toFixed(2)} />
                  <Line type="monotone" dataKey="national" stroke={HOG_LINE.national} dot={false} strokeWidth={2} connectNulls name="National" />
                  <Line type="monotone" dataKey="iowaMn" stroke={HOG_LINE.iowaMn} dot={false} strokeWidth={2} connectNulls name="Iowa/MN" />
                  <Line type="monotone" dataKey="western" stroke={HOG_LINE.western} dot={false} strokeWidth={2} connectNulls name="Western" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {tab === "pork" && (
        <>
          <section className="panel metrics">
            <article>
              <h2>Latest carcass</h2>
              <p className="metric metric--brown1">{fmt(porkLast?.pork_carcass)}</p>
            </article>
            <article>
              <h2>Latest belly</h2>
              <p className="metric metric--brown2">{fmt(porkLast?.pork_belly)}</p>
            </article>
            <article>
              <h2>Latest loin</h2>
              <p className="metric metric--brown3">{fmt(porkLast?.pork_loin)}</p>
            </article>
            <article>
              <h2>Days in range</h2>
              <p className="metric metric--brown4">{porkRows.length}</p>
            </article>
          </section>

          <section className="panel table-wrap">
            <div className="table-wrap-head">
              <h2>Daily negotiated data ($/cwt)</h2>
              <div className="field field--table-sort">
                <label htmlFor="tableDateOrderPork">Table order by date</label>
                <select
                  id="tableDateOrderPork"
                  className="select-brown select-brown--compact"
                  value={tableDateOrder}
                  onChange={(e) => setTableDateOrder(e.target.value as TableDateOrder)}
                >
                  <option value="asc">Oldest at top → newest down</option>
                  <option value="desc">Newest at top → oldest down</option>
                </select>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Carcass</th>
                    <th>Loin</th>
                    <th>Butt</th>
                    <th>Picnic</th>
                    <th>Rib</th>
                    <th>Ham</th>
                    <th>Belly</th>
                  </tr>
                </thead>
                <tbody>
                  {porkRowsForTable.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className={row.pork_carcass != null ? "td-br1" : "val-null"}>{fmt(row.pork_carcass)}</td>
                      <td className={row.pork_loin != null ? "td-br2" : "val-null"}>{fmt(row.pork_loin)}</td>
                      <td className={row.pork_butt != null ? "td-br3" : "val-null"}>{fmt(row.pork_butt)}</td>
                      <td>{fmt(row.pork_picnic)}</td>
                      <td>{fmt(row.pork_rib)}</td>
                      <td>{fmt(row.pork_ham)}</td>
                      <td className={row.pork_belly != null ? "td-br1" : "val-null"}>{fmt(row.pork_belly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel chart-wrap">
            <h2>Negotiated price trend ($/cwt)</h2>
            <div className="legend">
              {(Object.keys(PORK_NEGOTIATED_LINE) as (keyof typeof PORK_NEGOTIATED_LINE)[]).map((k) => (
                <span key={k} className="legend-item">
                  <span className="legend-dot" style={{ background: PORK_NEGOTIATED_LINE[k] }} />
                  {PORK_FIELD_LABELS[k.replace("pork_", "") as PorkCutKey]}
                </span>
              ))}
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={porkRowsChrono} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d5c4" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    tickFormatter={(v: string) => v.slice(0, 7)}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={44}
                  />
                  <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12 }} formatter={(v: number) => v?.toFixed(2)} />
                  {(Object.keys(PORK_NEGOTIATED_LINE) as (keyof typeof PORK_NEGOTIATED_LINE)[]).map((k) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={PORK_NEGOTIATED_LINE[k]}
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      name={PORK_FIELD_LABELS[k.replace("pork_", "") as PorkCutKey]}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {tab === "pork-comprehensive" && (
        <>
          <section className="panel metrics">
            <article>
              <h2>Latest carcass</h2>
              <p className="metric metric--brown1">{fmt(porkComprehensiveLast?.carcass)}</p>
            </article>
            <article>
              <h2>Latest belly</h2>
              <p className="metric metric--brown2">{fmt(porkComprehensiveLast?.belly)}</p>
            </article>
            <article>
              <h2>Latest spread</h2>
              <p className="metric metric--brown3">{fmt(porkComparisonLatest?.spread ?? null)}</p>
            </article>
            <article>
              <h2>Weeks in range</h2>
              <p className="metric metric--brown4">{porkComprehensiveRows.length}</p>
            </article>
          </section>

          <section className="panel table-wrap">
            <div className="table-wrap-head">
              <h2>Weekly Comprehensive Pork Prices ($/cwt)</h2>
              <div className="field field--table-sort">
                <label htmlFor="tableDateOrderPorkComprehensive">Table order by week</label>
                <select
                  id="tableDateOrderPorkComprehensive"
                  className="select-brown select-brown--compact"
                  value={tableDateOrder}
                  onChange={(e) => setTableDateOrder(e.target.value as TableDateOrder)}
                >
                  <option value="asc">Oldest at top â†’ newest down</option>
                  <option value="desc">Newest at top â†’ oldest down</option>
                </select>
              </div>
            </div>
            {porkComprehensiveRowsChrono.some((r) => r.synthesized) && (
              <p className="admin-panel__hint">
                USDA stopped publishing LM_PK680 on 2025-06-30. Weeks marked * are
                derived from LM_PK602 daily negotiated prices averaged per week, so the
                table stays current — note these reflect negotiated trade only, not the
                contract/formula blend the original comprehensive report included.
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Carcass</th>
                    <th>Loin</th>
                    <th>Butt</th>
                    <th>Picnic</th>
                    <th>Rib</th>
                    <th>Ham</th>
                    <th>Belly</th>
                  </tr>
                </thead>
                <tbody>
                  {porkComprehensiveRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="admin-preview-empty">
                        No comprehensive pork rows in this range.
                      </td>
                    </tr>
                  ) : (
                    porkComprehensiveRowsForTable.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}{row.synthesized ? " *" : ""}</td>
                        <td className={row.carcass != null ? "td-br1" : "val-null"}>{fmt(row.carcass)}</td>
                        <td className={row.loin != null ? "td-br2" : "val-null"}>{fmt(row.loin)}</td>
                        <td className={row.butt != null ? "td-br3" : "val-null"}>{fmt(row.butt)}</td>
                        <td>{fmt(row.picnic)}</td>
                        <td>{fmt(row.rib)}</td>
                        <td>{fmt(row.ham)}</td>
                        <td className={row.belly != null ? "td-br1" : "val-null"}>{fmt(row.belly)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel chart-wrap">
            <div className="table-wrap-head">
              <h2>Negotiated vs Comprehensive ($/cwt)</h2>
              <div className="field field--table-sort">
                <label htmlFor="porkComparisonCut">Cut for comparison</label>
                <select
                  id="porkComparisonCut"
                  className="select-brown select-brown--compact"
                  value={porkComparisonCut}
                  onChange={(e) => setPorkComparisonCut(e.target.value as PorkCutKey)}
                >
                  {(Object.keys(PORK_FIELD_LABELS) as PorkCutKey[]).map((cut) => (
                    <option key={cut} value={cut}>
                      {PORK_FIELD_LABELS[cut]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="admin-panel__hint">
              Negotiated is averaged from LM_PK602 daily rows into weekly Friday buckets so it can be compared directly against LM_PK680 week-ending values.
            </p>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: PORK_CUT_COLORS[porkComparisonCut] }} />
                Negotiated weekly avg
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#1d4ed8" }} />
                Comprehensive
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#57534e" }} />
                Spread
              </span>
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={porkComparisonData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d5c4" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    tickFormatter={(v: string) => v.slice(0, 7)}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={44}
                  />
                  <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12 }} formatter={(v: number) => v?.toFixed(2)} />
                  <Line
                    type="monotone"
                    dataKey="negotiated"
                    stroke={PORK_CUT_COLORS[porkComparisonCut]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    name="Negotiated weekly avg"
                  />
                  <Line
                    type="monotone"
                    dataKey="comprehensive"
                    stroke="#1d4ed8"
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    name="Comprehensive"
                  />
                  <Line
                    type="monotone"
                    dataKey="spread"
                    stroke="#57534e"
                    strokeDasharray="6 4"
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    name="Spread"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {tab === "turkey" && (
        <>
          <section className="panel metrics">
            <article>
              <h2>Whole Hen fresh (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.Fresh }}>
                {fmt(latestWholeHenFresh?.wtd_avg ?? null)}
              </p>
            </article>
            <article>
              <h2>Whole Hen frozen (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.Frozen }}>
                {fmt(latestWholeHenFrozen?.wtd_avg ?? null)}
              </p>
            </article>
            <article>
              <h2>Breast fresh (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.BreastFresh }}>
                {fmt(latestBreastFresh?.wtd_avg ?? null)}
              </p>
            </article>
            <article>
              <h2>Breast frozen (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.BreastFrozen }}>
                {fmt(latestBreastFrozen?.wtd_avg ?? null)}
              </p>
            </article>
            <article>
              <h2>Whole Hen fresh YTD</h2>
              <p className="metric" style={{ color: TURKEY_LINE.Fresh }}>{fmt(avgFresh)}</p>
            </article>
            <article>
              <h2>Whole Hen rows</h2>
              <p className="metric" style={{ color: TURKEY_LINE.Frozen }}>{turkeyRows.length}</p>
            </article>
          </section>

          <section className="panel table-wrap">
            <div className="table-wrap-head">
              <h2>WEEKLY DATA TURKEY BREASTS FRESH</h2>
              <div className="field field--table-sort">
                <label htmlFor="tableDateOrderTurkey">Table order by week</label>
                <select
                  id="tableDateOrderTurkey"
                  className="select-brown select-brown--compact"
                  value={tableDateOrder}
                  onChange={(e) => setTableDateOrder(e.target.value as TableDateOrder)}
                >
                  <option value="asc">Oldest at top → newest down</option>
                  <option value="desc">Newest at top → oldest down</option>
                </select>
              </div>
            </div>
            <p className="admin-panel__hint">
              Showing the Fresh breast series only, with the same simple columns as your source sheet.
              USDA volume is reported in units of 1,000 lbs.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week start</th>
                    <th>Week end</th>
                    <th>Wtd avg (¢)</th>
                    <th>Volume (1,000 lbs)</th>
                  </tr>
                </thead>
                <tbody>
                  {turkeyBreastFreshRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="admin-preview-empty">
                        No fresh breast rows in this range.
                      </td>
                    </tr>
                  ) : (
                    turkeyBreastFreshRowsForTable.map((row) => (
                      <tr key={turkeyRowKey(row)}>
                        <td>{row.week_start}</td>
                        <td>{row.week_end}</td>
                        <td className="td-br1">{fmt(row.wtd_avg)}</td>
                        <td>{fmtVolume(row.volume_1000_lbs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel chart-wrap">
            <h2>Price trend</h2>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: TURKEY_LINE.Fresh }} />
                Whole Hen Fresh
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: TURKEY_LINE.Frozen }} />
                Whole Hen Frozen
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: TURKEY_LINE.BreastFresh }} />
                Breast Tom Fresh
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: TURKEY_LINE.BreastFrozen }} />
                Breast Tom Frozen
              </span>
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d5c4" />
                  <XAxis
                    dataKey="isoDate"
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    tickFormatter={(v: string) => v.slice(0, 7)}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#78716c" }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={44}
                  />
                  <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12 }} formatter={(v: number) => v?.toFixed(2)} />
                  <Line type="monotone" dataKey="Fresh" stroke={TURKEY_LINE.Fresh} dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="Frozen" stroke={TURKEY_LINE.Frozen} dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="BreastFresh" stroke={TURKEY_LINE.BreastFresh} dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="BreastFrozen" stroke={TURKEY_LINE.BreastFrozen} dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      <section className="panel admin-data-preview" aria-label="Session data tables">
        <h2 className="admin-panel__title">Data in this session</h2>
        <p className="admin-panel__hint">
          Always shown: daily hog ($/cwt), weekly turkey (¢/lb), and daily pork cutout ($/cwt) for the same
          date range as the controls above or the filters below.
        </p>

        <div className="admin-preview-controls">
          <div className="field">
            <label htmlFor="adminStartDate">Start date</label>
            <input
              id="adminStartDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adminEndDate">End date</label>
            <input
              id="adminEndDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adminTableOrder">Table order</label>
            <select
              id="adminTableOrder"
              className="select-brown select-brown--compact"
              value={tableDateOrder}
              onChange={(e) => setTableDateOrder(e.target.value as TableDateOrder)}
            >
              <option value="asc">Oldest first</option>
              <option value="desc">Newest first</option>
            </select>
          </div>
        </div>

        <div className="admin-preview-tables">
          <div className="admin-preview-table">
            <div className="admin-preview-table__head">
              <h3>Daily hogs · LM_HG217</h3>
              <span className="admin-preview-count">
                {hogRows.length} day{hogRows.length === 1 ? "" : "s"}
              </span>
            </div>
            {hogMeta && (
              <p className="admin-preview-meta">Last hog pull / file timestamp: {formatUpdatedEn(hogMeta)}</p>
            )}
            <div className="table-scroll admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>National</th>
                    <th>Iowa/MN</th>
                    <th>W. Cornbelt</th>
                  </tr>
                </thead>
                <tbody>
                  {hogRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="admin-preview-empty">
                        No hog rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    hogRowsForTable.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td className={row.national != null ? "td-br1" : "val-null"}>{fmt(row.national)}</td>
                        <td className={row.iowaMn != null ? "td-br2" : "val-null"}>{fmt(row.iowaMn)}</td>
                        <td className={row.western != null ? "td-br3" : "val-null"}>{fmt(row.western)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-preview-table">
            <div className="admin-preview-table__head">
              <h3>Weekly turkey Breast · AMS_3647</h3>
              <span className="admin-preview-count">
                {turkeyBreastRows.length} row{turkeyBreastRows.length === 1 ? "" : "s"}
              </span>
            </div>
            {turkeyMeta && (
              <p className="admin-preview-meta">Last turkey pull / file timestamp: {formatUpdatedEn(turkeyMeta)}</p>
            )}
            <div className="table-scroll admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week start</th>
                    <th>Week end</th>
                    <th>Condition</th>
                    <th>Low (¢)</th>
                    <th>High (¢)</th>
                    <th>Wtd avg (¢)</th>
                    <th>Volume (1,000 lbs)</th>
                  </tr>
                </thead>
                <tbody>
                  {turkeyBreastRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="admin-preview-empty">
                        No turkey breast rows in this range.
                      </td>
                    </tr>
                  ) : (
                    turkeyBreastRowsForTable.map((row) => {
                      const cls = row.condition === "Fresh" ? "td-br1" : "td-br2";
                      return (
                        <tr key={turkeyRowKey(row)}>
                          <td>{row.week_start}</td>
                          <td>{row.week_end}</td>
                          <td className={cls}>{row.condition}</td>
                          <td className={cls}>{fmt(row.low_price)}</td>
                          <td className={cls}>{fmt(row.high_price)}</td>
                          <td className={cls}>{fmt(row.wtd_avg)}</td>
                          <td>{fmtVolume(row.volume_1000_lbs)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-preview-table">
            <div className="admin-preview-table__head">
              <h3>Weekly turkey Whole Hen · AMS_3647</h3>
              <span className="admin-preview-count">
                {turkeyRows.length} row{turkeyRows.length === 1 ? "" : "s"}
              </span>
            </div>
            {turkeyMeta && (
              <p className="admin-preview-meta">Last turkey pull / file timestamp: {formatUpdatedEn(turkeyMeta)}</p>
            )}
            <div className="table-scroll admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week start</th>
                    <th>Week end</th>
                    <th>Condition</th>
                    <th>Low (¢)</th>
                    <th>High (¢)</th>
                    <th>Wtd avg (¢)</th>
                    <th>Volume (1,000 lbs)</th>
                  </tr>
                </thead>
                <tbody>
                  {turkeyRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="admin-preview-empty">
                        No turkey rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    turkeyRowsForTable.map((row) => {
                      const cls = row.condition === "Fresh" ? "td-br1" : "td-br2";
                      return (
                        <tr key={turkeyRowKey(row)}>
                          <td>{row.week_start}</td>
                          <td>{row.week_end}</td>
                          <td className={cls}>{row.condition}</td>
                          <td className={cls}>{fmt(row.low_price)}</td>
                          <td className={cls}>{fmt(row.high_price)}</td>
                          <td className={cls}>{fmt(row.wtd_avg)}</td>
                          <td>{fmtVolume(row.volume_1000_lbs)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-preview-table">
            <div className="admin-preview-table__head">
              <h3>Daily pork · LM_PK602</h3>
              <span className="admin-preview-count">
                {porkRows.length} day{porkRows.length === 1 ? "" : "s"}
              </span>
            </div>
            {porkMeta && (
              <p className="admin-preview-meta">Last pork pull / file timestamp: {formatUpdatedEn(porkMeta)}</p>
            )}
            <div className="table-scroll admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Carcass</th>
                    <th>Loin</th>
                    <th>Butt</th>
                    <th>Picnic</th>
                    <th>Rib</th>
                    <th>Ham</th>
                    <th>Belly</th>
                  </tr>
                </thead>
                <tbody>
                  {porkRowsForTable.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="admin-preview-empty">
                        No pork rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    porkRowsForTable.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{fmt(row.pork_carcass)}</td>
                        <td>{fmt(row.pork_loin)}</td>
                        <td>{fmt(row.pork_butt)}</td>
                        <td>{fmt(row.pork_picnic)}</td>
                        <td>{fmt(row.pork_rib)}</td>
                        <td>{fmt(row.pork_ham)}</td>
                        <td>{fmt(row.pork_belly)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
