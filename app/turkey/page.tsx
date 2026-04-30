"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const DATA_URL = "/data/turkey_hen_weekly.json";

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
  const [m, d, y] = mmddyyyy.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function fmt(v: number | null | undefined) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

function formatUpdated(raw?: string) {
  if (!raw) return null;
  const s = raw.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    ...(/T\d/.test(s) ? { timeStyle: "short" } : {}),
  } as Intl.DateTimeFormatOptions).format(d);
}

function exportExcel(rows: TurkeyRow[]) {
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

const COLORS = { Fresh: "#d97706", Frozen: "#1d6fca" };

export default function TurkeyPricesPage() {
  const [fullRows, setFullRows] = useState<TurkeyRow[]>([]);
  const [currentRows, setCurrentRows] = useState<TurkeyRow[]>([]);
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(todayIso());
  const [condition, setCondition] = useState<Condition>("all");
  const [status, setStatus] = useState("Initializing…");
  const [generatedAt, setGeneratedAt] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadDataset = useCallback(async (bustCache = false) => {
    setStatus("Loading dataset…");
    const res = await fetch(DATA_URL, { cache: bustCache ? "no-store" : "default" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: TurkeyPayload = await res.json();
    const normalized: TurkeyRow[] = (payload.rows ?? []).map((r) => ({
      ...r,
      isoDate: toIso(r.week_start),
    }));
    setFullRows(normalized);
    setGeneratedAt(payload.generatedAt);
    return normalized;
  }, []);

  const applyFilter = useCallback(
    (rows: TurkeyRow[], start: string, end: string, cond: Condition) => {
      if (!start || !end || start > end) {
        setStatus("Choose a valid date range.");
        return;
      }
      const filtered = rows
        .filter((r) => r.isoDate >= start && r.isoDate <= end)
        .filter((r) => cond === "all" || r.condition === cond)
        .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
      setCurrentRows(filtered);
      setStatus(
        filtered.length
          ? `${filtered.length} records · ${start} → ${end}`
          : "No data for the selected range."
      );
    },
    []
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const rows = await loadDataset();
        applyFilter(rows, startDate, endDate, condition);
      } catch (e: unknown) {
        setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoad() {
    applyFilter(fullRows, startDate, endDate, condition);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const rows = await loadDataset(true);
      applyFilter(rows, startDate, endDate, condition);
    } catch (e: unknown) {
      setStatus(`Làm mới thất bại: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  const freshRows = currentRows.filter((r) => r.condition === "Fresh");
  const frozenRows = currentRows.filter((r) => r.condition === "Frozen");
  const lastFresh = freshRows[freshRows.length - 1];
  const lastFrozen = frozenRows[frozenRows.length - 1];
  const thisYear = new Date().getFullYear().toString();
  const ytdFresh = freshRows.filter((r) => r.isoDate.startsWith(thisYear));
  const avgFresh =
    ytdFresh.length
      ? ytdFresh.reduce((s, r) => s + Number(r.wtd_avg), 0) / ytdFresh.length
      : null;

  const updatedLabel = formatUpdated(generatedAt);

  // Build chart data: one entry per unique week, with Fresh + Frozen values
  const chartDataMap = new Map<string, { isoDate: string; Fresh?: number; Frozen?: number }>();
  currentRows.forEach((r) => {
    const entry = chartDataMap.get(r.isoDate) ?? { isoDate: r.isoDate };
    if (r.condition === "Fresh") entry.Fresh = Number(r.wtd_avg);
    if (r.condition === "Frozen") entry.Frozen = Number(r.wtd_avg);
    chartDataMap.set(r.isoDate, entry);
  });
  const chartData = Array.from(chartDataMap.values()).sort((a, b) =>
    a.isoDate.localeCompare(b.isoDate)
  );

  return (
    <main className="shell">
      {/* Hero */}
      <header className="hero">
        <div className="hero-top">
          <Link href="/" className="btn-refresh" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            ← Hog Prices
          </Link>
          <button
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Tải lại dữ liệu mới nhất"
          >
            {refreshing ? "Đang tải…" : "Làm mới dữ liệu"}
          </button>
        </div>
        <p className="eyebrow">USDA MARS API · AMS_3647</p>
        <h1>Weekly Turkey Prices</h1>
        <p className="sub">Whole Young Hen · 8–16 lb · U.S. Grade A — cents per lb.</p>
        {updatedLabel && <p className="data-updated">Đã cập nhật: {updatedLabel}</p>}
      </header>

      {/* Controls */}
      <section className="panel controls">
        <div className="field">
          <label htmlFor="startDate">Start date</label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="endDate">End date</label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <button className="btn-load" style={{ background: "#7c3aed" }} onClick={handleLoad} disabled={loading}>
          Load Prices
        </button>
        <button
          className="btn-export"
          onClick={() => exportExcel(currentRows)}
          disabled={currentRows.length === 0}
        >
          Export Excel
        </button>
        <p className="status">{status}</p>
      </section>

      {/* Condition filter */}
      <section className="panel" style={{ padding: "12px 20px" }}>
        <div className="filter-row">
          <label htmlFor="condFilter">Show condition:</label>
          <select
            id="condFilter"
            value={condition}
            onChange={(e) => {
              const val = e.target.value as Condition;
              setCondition(val);
              applyFilter(fullRows, startDate, endDate, val);
            }}
          >
            <option value="all">Fresh + Frozen</option>
            <option value="Fresh">Fresh only</option>
            <option value="Frozen">Frozen only</option>
          </select>
        </div>
      </section>

      {/* Metrics */}
      <section className="panel metrics">
        <article>
          <h2>Latest Fresh (¢/lb)</h2>
          <p className="metric fresh">{fmt(lastFresh?.wtd_avg)}</p>
        </article>
        <article>
          <h2>Latest Frozen (¢/lb)</h2>
          <p className="metric frozen">{fmt(lastFrozen?.wtd_avg)}</p>
        </article>
        <article>
          <h2>Avg Fresh YTD</h2>
          <p className="metric fresh">{fmt(avgFresh)}</p>
        </article>
        <article>
          <h2>Total Weeks</h2>
          <p className="metric weeks">{currentRows.length}</p>
        </article>
      </section>

      {/* Chart */}
      <section className="panel chart-wrap">
        <h2>Price Trend</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: COLORS.Fresh }} />
            Fresh
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: COLORS.Frozen }} />
            Frozen
          </span>
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecf0" />
              <XAxis
                dataKey="isoDate"
                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={(v: string) => v.slice(0, 7)}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#9ca3af" }}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => v.toFixed(0)}
                width={44}
              />
              <Tooltip
                contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12 }}
                formatter={(value: number) => value?.toFixed(2)}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              <Line
                type="monotone"
                dataKey="Fresh"
                stroke={COLORS.Fresh}
                dot={false}
                strokeWidth={1.8}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="Frozen"
                stroke={COLORS.Frozen}
                dot={false}
                strokeWidth={1.8}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Table */}
      <section className="panel table-wrap">
        <h2>Weekly Data</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Week Start</th>
                <th>Week End</th>
                <th>Condition</th>
                <th>Low (¢)</th>
                <th>High (¢)</th>
                <th>Wtd Avg (¢)</th>
                <th>Volume (lbs)</th>
              </tr>
            </thead>
            <tbody>
              {currentRows.map((row, i) => {
                const cls = row.condition === "Fresh" ? "val-fresh" : "val-frozen";
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
    </main>
  );
}
