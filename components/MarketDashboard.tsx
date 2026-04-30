"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

  const [status, setStatus] = useState("Loading…");
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function refreshFixed() {
    setRefreshing(true);
    try {
      setStatus("Refreshing data from server…");
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
      setStatus(
        n > 0
          ? `Refreshed · ${n} ${tab === "hog" ? "trading days" : "rows"} in range`
          : "Refreshed · no rows in range."
      );
    } catch (e) {
      setStatus(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  function selectTab(t: Tab) {
    setTab(t);
    syncTabToUrl(t);
  }

  const hogLast = hogRows[hogRows.length - 1];
  const freshRows = turkeyRows.filter((r) => r.condition === "Fresh");
  const frozenRows = turkeyRows.filter((r) => r.condition === "Frozen");
  const lastFresh = freshRows[freshRows.length - 1];
  const lastFrozen = frozenRows[frozenRows.length - 1];
  const thisYear = new Date().getFullYear().toString();
  const ytdFresh = freshRows.filter((r) => r.isoDate.startsWith(thisYear));
  const avgFresh =
    ytdFresh.length > 0 ? ytdFresh.reduce((s, r) => s + Number(r.wtd_avg), 0) / ytdFresh.length : null;

  const chartDataMap = new Map<string, { isoDate: string; Fresh?: number; Frozen?: number }>();
  turkeyRows.forEach((r) => {
    const entry = chartDataMap.get(r.isoDate) ?? { isoDate: r.isoDate };
    if (r.condition === "Fresh") entry.Fresh = Number(r.wtd_avg);
    if (r.condition === "Frozen") entry.Frozen = Number(r.wtd_avg);
    chartDataMap.set(r.isoDate, entry);
  });
  const chartData = Array.from(chartDataMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

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
        <button
          type="button"
          className="btn-neon-refresh"
          onClick={() => void refreshFixed()}
          disabled={refreshing}
          title="Reload JSON from the server (latest deployed files)"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
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

      <section className="panel controls controls--dashboard">
        <div className="field">
          <label htmlFor="startDate">Start date</label>
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="endDate">End date</label>
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
          onClick={() => (tab === "hog" ? exportHog(hogRows) : exportTurkey(turkeyRows))}
          disabled={tab === "hog" ? hogRows.length === 0 : turkeyRows.length === 0}
        >
          Export Excel
        </button>
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
                <LineChart data={hogRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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

          <section className="panel table-wrap">
            <h2>Daily data</h2>
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
                  {hogRows.map((row) => (
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

          <section className="panel table-wrap">
            <h2>Weekly data</h2>
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
                  {turkeyRows.map((row, i) => {
                    const cls = row.condition === "Fresh" ? "td-br1" : "td-br2";
                    return (
                      <tr key={i}>
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
        </>
      )}
    </main>
  );
}
