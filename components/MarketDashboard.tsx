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

type Tab = "hog" | "turkey" | "pork" | "admin";

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
  low_price: number;
  high_price: number;
  wtd_avg: number;
  volume_lbs: string | null;
  breast_wtd_avg: number | null;
  isoDate: string;
}

interface TurkeyPayload {
  generatedAt?: string;
  rows: Omit<TurkeyRow, "isoDate">[];
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

function fmt(v: number | null | undefined) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
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

function turkeyKey(r: { isoDate: string; condition: string }) {
  return `${r.isoDate}\0${r.condition}`;
}

function mergeTurkeyRows(prev: TurkeyRow[], incoming: Omit<TurkeyRow, "isoDate">[]): TurkeyRow[] {
  const mapped: TurkeyRow[] = incoming.map((r) => ({
    ...r,
    isoDate: toIso(r.week_start),
    wtd_avg: typeof r.wtd_avg === "number" ? r.wtd_avg : Number(r.wtd_avg),
    low_price: typeof r.low_price === "number" ? r.low_price : Number(r.low_price),
    high_price: typeof r.high_price === "number" ? r.high_price : Number(r.high_price),
  }));
  const map = new Map<string, TurkeyRow>();
  for (const r of prev) map.set(turkeyKey(r), r);
  for (const r of mapped) map.set(turkeyKey(r), r);
  return [...map.values()].sort(
    (a, b) => a.isoDate.localeCompare(b.isoDate) || a.condition.localeCompare(b.condition)
  );
}

const TURKEY_LINE = { Fresh: "#92400e", Frozen: "#451a03", BreastFresh: "#c2410c", BreastFrozen: "#7c2d12" };

const PORK_LINE = {
  pork_carcass: "#b91c1c",
  pork_loin: "#d97706",
  pork_butt: "#16a34a",
  pork_picnic: "#0891b2",
  pork_rib: "#7c3aed",
  pork_ham: "#db2777",
  pork_belly: "#ea580c",
};

const PORK_FIELD_LABELS: Record<keyof typeof PORK_LINE, string> = {
  pork_carcass: "Carcass",
  pork_loin: "Loin",
  pork_butt: "Butt",
  pork_picnic: "Picnic",
  pork_rib: "Rib",
  pork_ham: "Ham",
  pork_belly: "Belly",
};

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

function exportTurkey(rows: TurkeyRow[]) {
  import("xlsx").then((XLSX) => {
    const data = [
      ["Week Start", "Week End", "Condition", "Low (¢/lb)", "High (¢/lb)", "Wtd Avg (¢/lb)", "Volume (lbs)"],
      ...rows.map((r) => [r.week_start, r.week_end, r.condition, r.low_price, r.high_price, r.wtd_avg, r.volume_lbs]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Turkey Hen 8-16lb");
    const from = rows[0]?.week_start ?? "start";
    const to = rows[rows.length - 1]?.week_start ?? "end";
    XLSX.writeFile(wb, `Turkey_WholeHen_8-16lb_${from}_${to}.xlsx`);
  });
}

export default function MarketDashboard({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(initialTab);

  const [startDate, setStartDate] = useState("2019-01-01");
  const [endDate, setEndDate] = useState(todayIso());

  /* Per-table date filters for the admin preview tables */
  const [hogAdminStart, setHogAdminStart] = useState("2019-01-01");
  const [hogAdminEnd, setHogAdminEnd] = useState(todayIso());
  const [turkeyAdminStart, setTurkeyAdminStart] = useState("2019-01-01");
  const [turkeyAdminEnd, setTurkeyAdminEnd] = useState(todayIso());
  const [porkAdminStart, setPorkAdminStart] = useState("2019-01-01");
  const [porkAdminEnd, setPorkAdminEnd] = useState(todayIso());

  const [hogFull, setHogFull] = useState<HogRow[]>([]);
  const [hogRows, setHogRows] = useState<HogRow[]>([]);
  const [hogMeta, setHogMeta] = useState<string | undefined>();

  const [turkeyFull, setTurkeyFull] = useState<TurkeyRow[]>([]);
  const [turkeyRows, setTurkeyRows] = useState<TurkeyRow[]>([]);
  const [turkeyMeta, setTurkeyMeta] = useState<string | undefined>();
  const [condition, setCondition] = useState<Condition>("all");
  const [tableDateOrder, setTableDateOrder] = useState<TableDateOrder>("desc");

  const [porkFull, setPorkFull] = useState<PorkRow[]>([]);
  const [porkRows, setPorkRows] = useState<PorkRow[]>([]);
  const [porkMeta, setPorkMeta] = useState<string | undefined>();

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
    const rows: TurkeyRow[] = (payload.rows ?? []).map((r) => ({
      ...r,
      isoDate: toIso(r.week_start),
    }));
    setTurkeyFull(rows);
    setTurkeyMeta(payload.generatedAt);
    return rows;
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
    (rows: TurkeyRow[], start: string, end: string, cond: Condition) => {
      if (!start || !end || start > end) {
        setTurkeyRows([]);
        return;
      }
      const filtered = rows
        .filter((r) => r.isoDate >= start && r.isoDate <= end)
        .filter((r) => cond === "all" || r.condition === cond)
        .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
      setTurkeyRows(filtered);
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

  /* Apply filters when dates / full data / condition change (debounced for date inputs) */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const invalidRange = !startDate || !endDate || startDate > endDate;
      const noLoadedData = !hogFull.length && !turkeyFull.length && !porkFull.length;

      filterHog(hogFull, startDate, endDate);
      filterTurkey(turkeyFull, startDate, endDate, condition);
      filterPork(porkFull, startDate, endDate);

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
          : turkeyFull.filter(
              (r) =>
                r.isoDate >= startDate &&
                r.isoDate <= endDate &&
                (condition === "all" || r.condition === condition)
            ).length;
      setStatus(
        n > 0
          ? `${n} ${tab === "hog" || tab === "pork" ? "trading days" : "rows"} in range ${startDate} → ${endDate}`
          : "No rows in this range for the current tab."
      );
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [startDate, endDate, hogFull, turkeyFull, porkFull, condition, filterHog, filterTurkey, filterPork, tab]);

  const reloadDeployedJson = useCallback(async () => {
    const [h, t, p] = await Promise.all([loadHog(true), loadTurkey(true), loadPork(true)]);
    filterHog(h, startDate, endDate);
    filterTurkey(t, startDate, endDate, condition);
    filterPork(p, startDate, endDate);
    const nHog = h.filter((r) => r.date >= startDate && r.date <= endDate).length;
    const nTurkey = t.filter(
      (r) =>
        r.isoDate >= startDate &&
        r.isoDate <= endDate &&
        (condition === "all" || r.condition === condition)
    ).length;
    const nPork = p.filter((r) => r.date >= startDate && r.date <= endDate).length;
    return { nHog, nTurkey, nPork };
  }, [loadHog, loadTurkey, loadPork, filterHog, filterTurkey, filterPork, startDate, endDate, condition]);

  const ensureSessionDataLoaded = useCallback(async () => {
    const [h, t, p] = await Promise.all([
      hogFull.length ? Promise.resolve(hogFull) : loadHog(false),
      turkeyFull.length ? Promise.resolve(turkeyFull) : loadTurkey(false),
      porkFull.length ? Promise.resolve(porkFull) : loadPork(false),
    ]);
    filterHog(h, startDate, endDate);
    filterTurkey(t, startDate, endDate, condition);
    filterPork(p, startDate, endDate);
    return {
      nHog: h.filter((r) => r.date >= startDate && r.date <= endDate).length,
      nTurkey: t.filter(
        (r) =>
          r.isoDate >= startDate &&
          r.isoDate <= endDate &&
          (condition === "all" || r.condition === condition)
      ).length,
      nPork: p.filter((r) => r.date >= startDate && r.date <= endDate).length,
    };
  }, [
    hogFull,
    turkeyFull,
    porkFull,
    loadHog,
    loadTurkey,
    loadPork,
    filterHog,
    filterTurkey,
    filterPork,
    startDate,
    endDate,
    condition,
  ]);

  useEffect(() => {
  ensureSessionDataLoaded();
  }, []);
  
  const pullUsdaRange = useCallback(
    async (apiTab: "hog" | "turkey" | "pork", start: string, end: string, introStatus: string) => {
      if (!start || !end || start > end) {
        setStatus("Choose a valid date range (start ≤ end).");
        return;
      }
      const myGen =
        apiTab === "hog" ? ++hogPullGenRef.current : apiTab === "pork" ? ++porkPullGenRef.current : 0;
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
          rows?: unknown[];
          generatedAt?: string;
          tab?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const rows = data.rows as Omit<TurkeyRow, "isoDate">[];
        setTurkeyFull((prev) => mergeTurkeyRows(prev, rows));
        setTurkeyMeta(data.generatedAt);
        const count = data.rows?.length ?? 0;
        setTurkeyFetchLog((prev) => [
          ...prev,
          { t: new Date().toISOString(), message: "USDA response received" },
          { t: new Date().toISOString(), message: `Done: ${count} row(s)` },
        ]);
        setStatus(
          count > 0
            ? `Loaded ${count} row(s) from USDA for ${start} → ${end}.`
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
    if (tab !== "hog" && tab !== "turkey" && tab !== "pork") return;
    const introMap: Record<"hog" | "turkey" | "pork", string> = {
      hog: `Fetching daily hog prices from USDA for ${startDate} → ${endDate}…`,
      turkey: `Fetching weekly turkey prices from USDA for ${startDate} → ${endDate}…`,
      pork: `Fetching daily pork cutout prices from USDA for ${startDate} → ${endDate}…`,
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
              const { nHog, nTurkey, nPork } = await reloadDeployedJson();
              if (!mountedRef.current) return;
              setStatus(
                nHog + nTurkey + nPork > 0
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

  const turkeyRowsChrono = useMemo(
    () =>
      [...turkeyRows].sort(
        (a, b) => a.isoDate.localeCompare(b.isoDate) || a.condition.localeCompare(b.condition)
      ),
    [turkeyRows]
  );

  const turkeyRowsForTable = useMemo(() => {
    const s = [...turkeyRowsChrono];
    if (tableDateOrder === "desc") s.reverse();
    return s;
  }, [turkeyRowsChrono, tableDateOrder]);

  const freshRows = turkeyRows.filter((r) => r.condition === "Fresh");

  /* Admin per-table filtered rows — filter from the full dataset using each table's own date range */
  const hogAdminRows = useMemo(() => {
    if (!hogAdminStart || !hogAdminEnd || hogAdminStart > hogAdminEnd) return [];
    const filtered = hogFull.filter((r) => r.date >= hogAdminStart && r.date <= hogAdminEnd);
    return tableDateOrder === "desc"
      ? filtered.sort((a, b) => b.date.localeCompare(a.date))
      : filtered.sort((a, b) => a.date.localeCompare(b.date));
  }, [hogFull, hogAdminStart, hogAdminEnd, tableDateOrder]);

  const turkeyAdminRows = useMemo(() => {
    if (!turkeyAdminStart || !turkeyAdminEnd || turkeyAdminStart > turkeyAdminEnd) return [];
    const filtered = turkeyFull
      .filter((r) => r.isoDate >= turkeyAdminStart && r.isoDate <= turkeyAdminEnd)
      .filter((r) => condition === "all" || r.condition === condition);
    return tableDateOrder === "desc"
      ? filtered.sort((a, b) => b.isoDate.localeCompare(a.isoDate) || b.condition.localeCompare(a.condition))
      : filtered.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.condition.localeCompare(b.condition));
  }, [turkeyFull, turkeyAdminStart, turkeyAdminEnd, condition, tableDateOrder]);

  const porkAdminRows = useMemo(() => {
    if (!porkAdminStart || !porkAdminEnd || porkAdminStart > porkAdminEnd) return [];
    const filtered = porkFull.filter((r) => r.date >= porkAdminStart && r.date <= porkAdminEnd);
    return tableDateOrder === "desc"
      ? filtered.sort((a, b) => b.date.localeCompare(a.date))
      : filtered.sort((a, b) => a.date.localeCompare(b.date));
  }, [porkFull, porkAdminStart, porkAdminEnd, tableDateOrder]);
  const frozenRows = turkeyRows.filter((r) => r.condition === "Frozen");
  const lastFresh = (() => {
    const s = [...freshRows].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    return s.length ? s[s.length - 1] : undefined;
  })();
  const lastFrozen = (() => {
    const s = [...frozenRows].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    return s.length ? s[s.length - 1] : undefined;
  })();
  const thisYear = new Date().getFullYear().toString();
  const ytdFresh = freshRows.filter((r) => r.isoDate.startsWith(thisYear));
  const avgFresh =
    ytdFresh.length > 0 ? ytdFresh.reduce((s, r) => s + Number(r.wtd_avg), 0) / ytdFresh.length : null;

  const chartData = useMemo(() => {
    const chartDataMap = new Map<string, { isoDate: string; Fresh?: number; Frozen?: number; BreastFresh?: number; BreastFrozen?: number }>();
    turkeyRows.forEach((r) => {
      const entry = chartDataMap.get(r.isoDate) ?? { isoDate: r.isoDate };
      if (r.condition === "Fresh") entry.Fresh = Number(r.wtd_avg);
      if (r.condition === "Frozen") entry.Frozen = Number(r.wtd_avg);
      if (r.condition === "Fresh" && r.breast_wtd_avg != null) entry.BreastFresh = Number(r.breast_wtd_avg);
      if (r.condition === "Frozen" && r.breast_wtd_avg != null) entry.BreastFrozen = Number(r.breast_wtd_avg);
      chartDataMap.set(r.isoDate, entry);
    });
    return Array.from(chartDataMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [turkeyRows]);

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
            Daily pork (LM_PK602)
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
            <h1>Daily pork cutout prices</h1>
            <p className="sub">Carcass, loin, butt, picnic, rib, ham, belly — $/cwt. Reloading this page clears all data until you press Refresh.</p>
            {porkMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(porkMeta)}</p>}
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
                : exportTurkey(turkeyRowsForTable)
            }
            disabled={
              tab === "hog"
                ? hogRows.length === 0
                : tab === "pork"
                ? porkRows.length === 0
                : turkeyRows.length === 0
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
              <h2>Daily data ($/cwt)</h2>
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
            <h2>Price trend ($/cwt)</h2>
            <div className="legend">
              {(Object.keys(PORK_LINE) as (keyof typeof PORK_LINE)[]).map((k) => (
                <span key={k} className="legend-item">
                  <span className="legend-dot" style={{ background: PORK_LINE[k] }} />
                  {PORK_FIELD_LABELS[k]}
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
                  {(Object.keys(PORK_LINE) as (keyof typeof PORK_LINE)[]).map((k) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={PORK_LINE[k]} dot={false} strokeWidth={2} connectNulls name={PORK_FIELD_LABELS[k]} />
                  ))}
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
              <h2>Breast fresh wtd avg (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.BreastFresh }}>{fmt(lastFresh?.breast_wtd_avg ?? null)}</p>
            </article>
            <article>
              <h2>Breast frozen wtd avg (¢/lb)</h2>
              <p className="metric" style={{ color: TURKEY_LINE.BreastFrozen }}>{fmt(lastFrozen?.breast_wtd_avg ?? null)}</p>
            </article>
          </section>

          <section className="panel table-wrap">
            <div className="table-wrap-head">
              <h2>Weekly data</h2>
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
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week start</th>
                    <th>Week end</th>
                    <th>Breast wtd avg (¢)</th>
                    <th>Volume (lbs)</th>
                  </tr>
                </thead>
                <tbody>
                  {turkeyRowsForTable.map((row) => {
                    const cls = row.condition === "Fresh" ? "td-br1" : "td-br2";
                    return (
                      <tr key={`${row.isoDate}-${row.condition}`}>
                        <td>{row.week_start}</td>
                        <td>{row.week_end}</td>
                        <td>{fmt(row.breast_wtd_avg ?? null)}</td>
                        <td>{row.volume_lbs ?? "-"}</td>
                      </tr>
                    );
                  })}
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
          Always shown: daily hog ($/cwt), weekly turkey (¢/lb), and daily pork cutout ($/cwt).
          Each table has its own date range filter.
        </p>

        <div className="admin-preview-controls">
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
                {hogAdminRows.length} day{hogAdminRows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="admin-preview-controls" style={{ marginBottom: 8 }}>
              <div className="field">
                <label htmlFor="hogAdminStart">Start date</label>
                <input id="hogAdminStart" type="date" value={hogAdminStart} onChange={(e) => setHogAdminStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="hogAdminEnd">End date</label>
                <input id="hogAdminEnd" type="date" value={hogAdminEnd} onChange={(e) => setHogAdminEnd(e.target.value)} />
              </div>
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
                  {hogAdminRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="admin-preview-empty">
                        No hog rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    hogAdminRows.map((row) => (
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
              <h3>Weekly turkey · AMS_3647</h3>
              <span className="admin-preview-count">
                {turkeyAdminRows.length} row{turkeyAdminRows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="admin-preview-controls" style={{ marginBottom: 8 }}>
              <div className="field">
                <label htmlFor="turkeyAdminStart">Start date</label>
                <input id="turkeyAdminStart" type="date" value={turkeyAdminStart} onChange={(e) => setTurkeyAdminStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="turkeyAdminEnd">End date</label>
                <input id="turkeyAdminEnd" type="date" value={turkeyAdminEnd} onChange={(e) => setTurkeyAdminEnd(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="adminCondFilter">Condition</label>
                <select
                  id="adminCondFilter"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as Condition)}
                  className="select-brown"
                >
                  <option value="all">Fresh + frozen</option>
                  <option value="Fresh">Fresh only</option>
                  <option value="Frozen">Frozen only</option>
                </select>
              </div>
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
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {turkeyAdminRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="admin-preview-empty">
                        No turkey rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    turkeyAdminRows.map((row) => {
                      const cls = row.condition === "Fresh" ? "td-br1" : "td-br2";
                      return (
                        <tr key={`${row.isoDate}-${row.condition}`}>
                          <td>{row.week_start}</td>
                          <td>{row.week_end}</td>
                          <td className={cls}>{row.condition}</td>
                          <td className={cls}>{fmt(row.low_price)}</td>
                          <td className={cls}>{fmt(row.high_price)}</td>
                          <td className={cls}>{fmt(row.wtd_avg)}</td>
                          <td>{row.volume_lbs ?? "-"}</td>
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
                {porkAdminRows.length} day{porkAdminRows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="admin-preview-controls" style={{ marginBottom: 8 }}>
              <div className="field">
                <label htmlFor="porkAdminStart">Start date</label>
                <input id="porkAdminStart" type="date" value={porkAdminStart} onChange={(e) => setPorkAdminStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="porkAdminEnd">End date</label>
                <input id="porkAdminEnd" type="date" value={porkAdminEnd} onChange={(e) => setPorkAdminEnd(e.target.value)} />
              </div>
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
                  {porkAdminRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="admin-preview-empty">
                        No pork rows in this range (session may be empty until Refresh or deploy reload).
                      </td>
                    </tr>
                  ) : (
                    porkAdminRows.map((row) => (
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
