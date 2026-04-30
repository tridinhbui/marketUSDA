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

const DATA_URL = "/data/lm_hg217_daily_prices.json";

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

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function exportExcel(rows: HogRow[]) {
  // Dynamic import to keep bundle lean
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

const TICK_COLORS = {
  national: "#d97706",
  iowaMn: "#1d6fca",
  western: "#1a9e6b",
};

export default function HogPricesPage() {
  const [fullRows, setFullRows] = useState<HogRow[]>([]);
  const [currentRows, setCurrentRows] = useState<HogRow[]>([]);
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(todayIso());
  const [status, setStatus] = useState("Initializing…");
  const [generatedAt, setGeneratedAt] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadDataset = useCallback(async (bustCache = false) => {
    setStatus("Loading dataset…");
    const res = await fetch(DATA_URL, { cache: bustCache ? "no-store" : "default" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: HogPayload = await res.json();
    setFullRows(Array.isArray(payload.rows) ? payload.rows : []);
    setGeneratedAt(payload.generatedAt);
    return payload.rows ?? [];
  }, []);

  const applyFilter = useCallback(
    (rows: HogRow[], start: string, end: string) => {
      if (!start || !end || start > end) {
        setStatus("Choose a valid date range.");
        return;
      }
      const filtered = rows
        .filter((r) => r.date >= start && r.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date));
      setCurrentRows(filtered);
      setStatus(
        filtered.length
          ? `${filtered.length} trading days · ${start} → ${end}`
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
        applyFilter(rows, startDate, endDate);
      } catch (e: unknown) {
        setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoad() {
    applyFilter(fullRows, startDate, endDate);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const rows = await loadDataset(true);
      applyFilter(rows, startDate, endDate);
    } catch (e: unknown) {
      setStatus(`Làm mới thất bại: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  const last = currentRows[currentRows.length - 1];
  const updatedLabel = formatUpdated(generatedAt);

  return (
    <main className="shell">
      {/* Hero */}
      <header className="hero">
        <div className="hero-top">
          <Link href="/turkey" className="btn-refresh" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            → Turkey Prices
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
        <p className="eyebrow">USDA MPR Datamart · LM_HG217</p>
        <h1>Daily Hog Prices</h1>
        <p className="sub">Negotiated carcass basis — National, Iowa/Minnesota, Western Cornbelt.</p>
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
        <button className="btn-load" onClick={handleLoad} disabled={loading}>
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

      {/* Metrics */}
      <section className="panel metrics">
        <article>
          <h2>Latest National</h2>
          <p className="metric national">{fmt(last?.national)}</p>
        </article>
        <article>
          <h2>Latest Iowa/MN</h2>
          <p className="metric iowamn">{fmt(last?.iowaMn)}</p>
        </article>
        <article>
          <h2>Latest W. Cornbelt</h2>
          <p className="metric western">{fmt(last?.western)}</p>
        </article>
        <article>
          <h2>Total Days</h2>
          <p className="metric days">{currentRows.length}</p>
        </article>
      </section>

      {/* Chart */}
      <section className="panel chart-wrap">
        <h2>Price Trend</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: TICK_COLORS.national }} />
            National
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: TICK_COLORS.iowaMn }} />
            Iowa/MN
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: TICK_COLORS.western }} />
            Western Cornbelt
          </span>
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={currentRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecf0" />
              <XAxis
                dataKey="date"
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
                dataKey="national"
                stroke={TICK_COLORS.national}
                dot={false}
                strokeWidth={1.8}
                connectNulls
                name="National"
              />
              <Line
                type="monotone"
                dataKey="iowaMn"
                stroke={TICK_COLORS.iowaMn}
                dot={false}
                strokeWidth={1.8}
                connectNulls
                name="Iowa/MN"
              />
              <Line
                type="monotone"
                dataKey="western"
                stroke={TICK_COLORS.western}
                dot={false}
                strokeWidth={1.8}
                connectNulls
                name="Western"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Table */}
      <section className="panel table-wrap">
        <h2>Daily Data</h2>
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
              {currentRows.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td className={row.national != null ? "val-national" : "val-null"}>
                    {fmt(row.national)}
                  </td>
                  <td className={row.iowaMn != null ? "val-iowamn" : "val-null"}>
                    {fmt(row.iowaMn)}
                  </td>
                  <td className={row.western != null ? "val-western" : "val-null"}>
                    {fmt(row.western)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
