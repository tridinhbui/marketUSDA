"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

type Tab = "hog" | "turkey";

interface HogRow {
  date: string;
  national: number | null;
  iowaMn: number | null;
  western: number | null;
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
  isoDate: string;
}

interface TurkeyPayload {
  generatedAt?: string;
  rows: Omit<TurkeyRow, "isoDate">[];
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

const TURKEY_LINE = { Fresh: "#92400e", Frozen: "#451a03" };

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

  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(todayIso());

  const [hogFull, setHogFull] = useState<HogRow[]>([]);
  const [hogRows, setHogRows] = useState<HogRow[]>([]);
  const [hogMeta, setHogMeta] = useState<string | undefined>();

  const [turkeyFull, setTurkeyFull] = useState<TurkeyRow[]>([]);
  const [turkeyRows, setTurkeyRows] = useState<TurkeyRow[]>([]);
  const [turkeyMeta, setTurkeyMeta] = useState<string | undefined>();
  const [condition, setCondition] = useState<Condition>("all");
  const [tableDateOrder, setTableDateOrder] = useState<TableDateOrder>("asc");

  const [status, setStatus] = useState("Loading…");
  const [fetchingRange, setFetchingRange] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hogUsdaAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Skip first hog date-range evaluation (no duplicate USDA hit on load). */
  const hogUsdaAutoInitRef = useRef(false);
  const lastHogUsdaKeyRef = useRef<string>("");
  /** Invalidate in-flight hog USDA responses when a newer hog request starts. */
  const hogPullGenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncTabToUrl = useCallback(
    (t: Tab) => {
      const q = new URLSearchParams(searchParams?.toString() ?? "");
      if (t === "turkey") q.set("tab", "turkey");
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

  /* Initial load both datasets */
  useEffect(() => {
    (async () => {
      try {
        setStatus("Loading datasets…");
        await Promise.all([loadHog(false), loadTurkey(false)]);
        setStatus("Select a date range. Data updates as you change dates.");
      } catch (e) {
        setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [loadHog, loadTurkey]);

  /* Apply filters when dates / full data / condition change (debounced for date inputs) */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!hogFull.length && !turkeyFull.length) return;
      if (!startDate || !endDate || startDate > endDate) {
        setStatus("Choose a valid date range (start ≤ end).");
        return;
      }
      filterHog(hogFull, startDate, endDate);
      filterTurkey(turkeyFull, startDate, endDate, condition);
      const n =
        tab === "hog"
          ? hogFull.filter((r) => r.date >= startDate && r.date <= endDate).length
          : turkeyFull.filter(
              (r) => r.isoDate >= startDate && r.isoDate <= endDate && (condition === "all" || r.condition === condition)
            ).length;
      setStatus(
        n > 0
          ? `${n} ${tab === "hog" ? "trading days" : "rows"} in range ${startDate} → ${endDate}`
          : "No rows in this range for the current tab."
      );
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [startDate, endDate, hogFull, turkeyFull, condition, filterHog, filterTurkey, tab]);

  const reloadDeployedJson = useCallback(async () => {
    const [h, t] = await Promise.all([loadHog(true), loadTurkey(true)]);
    filterHog(h, startDate, endDate);
    filterTurkey(t, startDate, endDate, condition);
    const n =
      tab === "hog"
        ? h.filter((r) => r.date >= startDate && r.date <= endDate).length
        : t.filter(
            (r) =>
              r.isoDate >= startDate &&
              r.isoDate <= endDate &&
              (condition === "all" || r.condition === condition)
          ).length;
    return n;
  }, [loadHog, loadTurkey, filterHog, filterTurkey, startDate, endDate, condition, tab]);

  const pullUsdaRange = useCallback(
    async (apiTab: "hog" | "turkey", start: string, end: string, introStatus: string) => {
      if (!start || !end || start > end) {
        setStatus("Choose a valid date range (start ≤ end).");
        return;
      }
      const myGen = apiTab === "hog" ? ++hogPullGenRef.current : 0;
      setFetchingRange(true);
      try {
        setStatus(introStatus);
        const res = await fetch(
          `/api/fetch-range?tab=${apiTab}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        );
        const data = (await res.json()) as {
          error?: string;
          rows?: unknown[];
          generatedAt?: string;
          tab?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (apiTab === "hog" && myGen !== hogPullGenRef.current) return;

        if (data.tab === "hog") {
          const rows = data.rows as HogRow[];
          setHogFull((prev) => mergeHogByDate(prev, rows));
          setHogMeta(data.generatedAt);
        } else {
          const rows = data.rows as Omit<TurkeyRow, "isoDate">[];
          setTurkeyFull((prev) => mergeTurkeyRows(prev, rows));
          setTurkeyMeta(data.generatedAt);
        }
        const count = data.rows?.length ?? 0;
        if (apiTab === "hog" && myGen !== hogPullGenRef.current) return;
        setStatus(
          count > 0
            ? `Loaded ${count} new row(s) from USDA for this range. Charts use merged data.`
            : `USDA returned no rows for that range — try different dates.`
        );
      } catch (e) {
        if (apiTab !== "hog" || myGen === hogPullGenRef.current) {
          setStatus(`Could not load fresh data: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        if (mountedRef.current) setFetchingRange(false);
      }
    },
    []
  );

  /* Daily hogs: after you change start/end, pull that window from USDA (debounced). */
  useEffect(() => {
    if (tab !== "hog") return;
    if (!startDate || !endDate || startDate > endDate) return;

    const key = `${startDate}|${endDate}`;
    if (!hogUsdaAutoInitRef.current) {
      hogUsdaAutoInitRef.current = true;
      lastHogUsdaKeyRef.current = key;
      return;
    }
    if (lastHogUsdaKeyRef.current === key) return;

    if (hogUsdaAutoTimerRef.current) clearTimeout(hogUsdaAutoTimerRef.current);
    hogUsdaAutoTimerRef.current = setTimeout(() => {
      lastHogUsdaKeyRef.current = key;
      void pullUsdaRange(
        "hog",
        startDate,
        endDate,
        `Loading daily hog prices from USDA for ${startDate} → ${endDate}…`
      );
    }, 650);

    return () => {
      if (hogUsdaAutoTimerRef.current) clearTimeout(hogUsdaAutoTimerRef.current);
    };
  }, [tab, startDate, endDate, pullUsdaRange]);

  async function fetchUsdaForRange() {
    if (tab === "hog") {
      const key = `${startDate}|${endDate}`;
      lastHogUsdaKeyRef.current = key;
      if (hogUsdaAutoTimerRef.current) {
        clearTimeout(hogUsdaAutoTimerRef.current);
        hogUsdaAutoTimerRef.current = null;
      }
    }
    await pullUsdaRange(
      tab === "hog" ? "hog" : "turkey",
      startDate,
      endDate,
      tab === "hog"
        ? `Fetching daily hog prices from USDA for ${startDate} → ${endDate}…`
        : `Fetching weekly turkey prices from USDA for ${startDate} → ${endDate}…`
    );
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
              const n = await reloadDeployedJson();
              if (!mountedRef.current) return;
              setStatus(
                n > 0
                  ? `Saved data refreshed · ${n} ${tab === "hog" ? "trading days" : "rows"} in your date range. If numbers look old, wait a minute and reload the page.`
                  : "Saved data refreshed · no rows in your current date range."
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
    const chartDataMap = new Map<string, { isoDate: string; Fresh?: number; Frozen?: number }>();
    turkeyRows.forEach((r) => {
      const entry = chartDataMap.get(r.isoDate) ?? { isoDate: r.isoDate };
      if (r.condition === "Fresh") entry.Fresh = Number(r.wtd_avg);
      if (r.condition === "Frozen") entry.Frozen = Number(r.wtd_avg);
      chartDataMap.set(r.isoDate, entry);
    });
    return Array.from(chartDataMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [turkeyRows]);

  return (
    <main className="shell">
      <header className="top-bar">
        <div className="tabs" role="tablist" aria-label="Dataset">
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
        </div>
      </header>

      <header className="hero">
        {tab === "hog" ? (
          <>
            <p className="eyebrow">USDA MPR Datamart · negotiated carcass</p>
            <h1>Daily hog prices</h1>
            <p className="sub">National, Iowa/Minnesota, and Western Cornbelt — $/cwt.</p>
            {hogMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(hogMeta)}</p>}
          </>
        ) : (
          <>
            <p className="eyebrow">USDA MARS · whole young hen 8–16 lb, Grade A</p>
            <h1>Weekly turkey prices</h1>
            <p className="sub">Prices in cents per pound; frozen vs fresh.</p>
            {turkeyMeta && <p className="data-updated">Dataset updated: {formatUpdatedEn(turkeyMeta)}</p>}
          </>
        )}
      </header>

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
            title={
              tab === "hog"
                ? "Daily hogs: changing the dates above also loads USDA automatically after a short pause. Use Refresh for an immediate pull."
                : "Pull the latest figures from USDA for the dates above (this browser tab only)."
            }
          >
            {fetchingRange ? "Loading…" : "Refresh"}
          </button>
        </div>
        {tab === "turkey" && (
          <div className="field field--grow">
            <label htmlFor="condFilter">Condition</label>
            <select
              id="condFilter"
              value={condition}
              onChange={(e) => setCondition(e.target.value as Condition)}
              className="select-brown"
            >
              <option value="all">Fresh + frozen</option>
              <option value="Fresh">Fresh only</option>
              <option value="Frozen">Frozen only</option>
            </select>
          </div>
        )}
        <button
          type="button"
          className="btn-brown btn-export-dash"
          onClick={() =>
            tab === "hog" ? exportHog(hogRowsForTable) : exportTurkey(turkeyRowsForTable)
          }
          disabled={tab === "hog" ? hogRows.length === 0 : turkeyRows.length === 0}
        >
          Export Excel
        </button>
        <details className="advanced-ops">
          <summary className="advanced-ops__summary">Advanced — update data for everyone</summary>
          <div className="advanced-ops__body">
            <p className="advanced-ops__hint">
              For site administrators only. Starts a long background task that refreshes the saved files on the server so all visitors see new numbers (several minutes; not the same as the Refresh button above).
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
          </div>
        </details>
        <p className="status status--full">{status}</p>
      </section>

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

      {tab === "turkey" && (
        <>
          <section className="panel metrics">
            <article>
              <h2>Latest fresh (¢/lb)</h2>
              <p className="metric metric--brown1">{fmt(lastFresh?.wtd_avg)}</p>
            </article>
            <article>
              <h2>Latest frozen (¢/lb)</h2>
              <p className="metric metric--brown2">{fmt(lastFrozen?.wtd_avg)}</p>
            </article>
            <article>
              <h2>Avg fresh YTD</h2>
              <p className="metric metric--brown1">{fmt(avgFresh)}</p>
            </article>
            <article>
              <h2>Rows in range</h2>
              <p className="metric metric--brown4">{turkeyRows.length}</p>
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
                    <th>Condition</th>
                    <th>Low (¢)</th>
                    <th>High (¢)</th>
                    <th>Wtd avg (¢)</th>
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
                        <td className={cls}>{row.condition}</td>
                        <td className={cls}>{fmt(row.low_price)}</td>
                        <td className={cls}>{fmt(row.high_price)}</td>
                        <td className={cls}>{fmt(row.wtd_avg)}</td>
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
                Fresh
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: TURKEY_LINE.Frozen }} />
                Frozen
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
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
