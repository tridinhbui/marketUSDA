const DATA_URL = "data/turkey_hen_weekly.json";

const statusEl    = document.getElementById("status");
const startEl     = document.getElementById("startDate");
const endEl       = document.getElementById("endDate");
const loadBtn     = document.getElementById("loadBtn");
const exportBtn   = document.getElementById("exportBtn");
const condFilter  = document.getElementById("condFilter");
const latestFreshEl  = document.getElementById("latestFresh");
const latestFrozenEl = document.getElementById("latestFrozen");
const avgFreshEl     = document.getElementById("avgFresh");
const totalWeeksEl   = document.getElementById("totalWeeks");
const tableBodyEl    = document.getElementById("tableBody");
const chartEl        = document.getElementById("priceChart");
const dataUpdatedEl  = document.getElementById("dataUpdated");

// ── helpers ────────────────────────────────────────────────────────────────────

function formatDataUpdatedLabel(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(s + "T12:00:00")
    : new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const hasTime = /T\d/.test(s);
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    ...(hasTime ? { timeStyle: "short" } : {}),
  }).format(d);
}

function showDataUpdated(iso) {
  if (!dataUpdatedEl) return;
  const label = formatDataUpdatedLabel(iso);
  if (!label) {
    dataUpdatedEl.hidden = true;
    dataUpdatedEl.textContent = "";
    return;
  }
  dataUpdatedEl.hidden = false;
  dataUpdatedEl.textContent = `Đã cập nhật: ${label}`;
}

function todayIso() {
  const d  = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Convert "MM/DD/YYYY" → "YYYY-MM-DD" for sorting/filtering
function toIso(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split("/");
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

function fmt(v) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

// ── data ───────────────────────────────────────────────────────────────────────

let fullRows    = [];
let currentRows = [];

async function loadDataset() {
  statusEl.textContent = "Loading dataset…";
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Cannot load ${DATA_URL} (HTTP ${res.status})`);
  const payload = await res.json();
  // Normalise: add isoDate field for easy comparison
  fullRows = (Array.isArray(payload.rows) ? payload.rows : []).map((r) => ({
    ...r,
    isoDate: toIso(r.week_start),
  }));
  showDataUpdated(payload.generatedAt);
}

function filterRows(start, end, cond) {
  return fullRows
    .filter((r) => r.isoDate >= start && r.isoDate <= end)
    .filter((r) => cond === "all" || r.condition === cond)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

// ── render ─────────────────────────────────────────────────────────────────────

function renderTable(rows) {
  tableBodyEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const isFresh = row.condition === "Fresh";
    const cls     = isFresh ? "val-fresh" : "val-frozen";
    const tr      = document.createElement("tr");
    tr.innerHTML = [
      `<td>${row.week_start}</td>`,
      `<td>${row.week_end}</td>`,
      `<td class="${cls}">${row.condition}</td>`,
      `<td class="${cls}">${fmt(row.low_price)}</td>`,
      `<td class="${cls}">${fmt(row.high_price)}</td>`,
      `<td class="${cls}">${fmt(row.wtd_avg)}</td>`,
      `<td>${row.volume_lbs != null ? row.volume_lbs : "-"}</td>`,
    ].join("");
    frag.appendChild(tr);
  });
  tableBodyEl.appendChild(frag);
}

function updateMetrics(rows) {
  totalWeeksEl.textContent = String(rows.length);

  const freshRows  = rows.filter((r) => r.condition === "Fresh");
  const frozenRows = rows.filter((r) => r.condition === "Frozen");

  const lastFresh  = freshRows[freshRows.length - 1];
  const lastFrozen = frozenRows[frozenRows.length - 1];

  latestFreshEl.textContent  = lastFresh  ? fmt(lastFresh.wtd_avg)  : "-";
  latestFrozenEl.textContent = lastFrozen ? fmt(lastFrozen.wtd_avg) : "-";

  // YTD average for Fresh
  const thisYear  = new Date().getFullYear().toString();
  const ytdFresh  = freshRows.filter((r) => r.isoDate.startsWith(thisYear));
  if (ytdFresh.length) {
    const avg = ytdFresh.reduce((s, r) => s + Number(r.wtd_avg), 0) / ytdFresh.length;
    avgFreshEl.textContent = fmt(avg);
  } else {
    avgFreshEl.textContent = "-";
  }
}

// ── chart ──────────────────────────────────────────────────────────────────────

const COLORS = { Fresh: "#d97706", Frozen: "#1d6fca" };

function drawChart(rows) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = chartEl.getBoundingClientRect();
  const W    = rect.width  || 1100;
  const H    = rect.height || 320;
  chartEl.width  = W * dpr;
  chartEl.height = H * dpr;
  const ctx = chartEl.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 24, right: 20, bottom: 28, left: 56 };
  const cw  = W - pad.left - pad.right;
  const ch  = H - pad.top  - pad.bottom;

  const allVals = rows.map((r) => r.wtd_avg).filter((v) => v != null);
  if (!allVals.length || rows.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px sans-serif";
    ctx.fillText("No data", 16, 22);
    return;
  }

  // Build a unique, sorted list of week_start dates for x-axis
  const allDates = [...new Set(rows.map((r) => r.isoDate))].sort();
  const dateIndex = Object.fromEntries(allDates.map((d, i) => [d, i]));
  const n = allDates.length;

  const minV   = Math.floor(Math.min(...allVals) - 2);
  const maxV   = Math.ceil(Math.max(...allVals)  + 2);
  const yScale = (v)   => pad.top  + ((maxV - v)     / (maxV - minV || 1)) * ch;
  const xScale = (idx) => pad.left + (idx             / (n - 1 || 1)) * cw;

  // grid + y labels
  ctx.strokeStyle = "#e9ecf0";
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 6; i++) {
    const y   = pad.top + (i / 6) * ch;
    const val = maxV - ((maxV - minV) * i) / 6;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font      = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(val.toFixed(0), pad.left - 6, y + 4);
  }

  // x labels ~14 ticks
  ctx.fillStyle = "#9ca3af";
  ctx.font      = "11px monospace";
  ctx.textAlign = "center";
  const step = Math.max(1, Math.round(allDates.length / 14));
  allDates.forEach((d, idx) => {
    if (idx % step === 0) ctx.fillText(d.slice(0, 7), xScale(idx), H - pad.bottom + 14);
  });

  // one line per condition
  ["Fresh", "Frozen"].forEach((cond) => {
    const series = rows.filter((r) => r.condition === cond);
    if (!series.length) return;
    ctx.strokeStyle = COLORS[cond];
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    let started = false;
    series.forEach((row) => {
      const idx = dateIndex[row.isoDate];
      const v   = row.wtd_avg;
      if (v == null) { started = false; return; }
      const x = xScale(idx), y = yScale(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else          { ctx.lineTo(x, y); }
    });
    ctx.stroke();
  });
}

// ── export ─────────────────────────────────────────────────────────────────────

function exportExcel(rows) {
  if (typeof XLSX === "undefined") {
    statusEl.textContent = "SheetJS not loaded.";
    return;
  }
  const data = [
    ["Week Start", "Week End", "Condition", "Low (¢/lb)", "High (¢/lb)", "Wtd Avg (¢/lb)", "Volume (lbs)"],
    ...rows.map((r) => [r.week_start, r.week_end, r.condition, r.low_price, r.high_price, r.wtd_avg, r.volume_lbs]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Turkey Hen 8-16lb");
  const from = rows[0]?.week_start ?? "start";
  const to   = rows[rows.length - 1]?.week_start ?? "end";
  XLSX.writeFile(wb, `Turkey_WholeHen_8-16lb_${from}_${to}.xlsx`);
}

// ── main flow ──────────────────────────────────────────────────────────────────

async function applyFilter() {
  const start = startEl.value;
  const end   = endEl.value;
  const cond  = condFilter.value;

  if (!start || !end || start > end) {
    statusEl.textContent = "Choose a valid date range.";
    return;
  }
  loadBtn.disabled      = true;
  exportBtn.disabled    = true;
  tableBodyEl.innerHTML = "";

  currentRows = filterRows(start, end, cond);
  renderTable(currentRows);
  updateMetrics(currentRows);
  drawChart(currentRows);

  statusEl.textContent = `${currentRows.length} records · ${start} → ${end}`;
  exportBtn.disabled = currentRows.length === 0;
  loadBtn.disabled   = false;
}

loadBtn.addEventListener("click", applyFilter);
condFilter.addEventListener("change", applyFilter);
exportBtn.addEventListener("click", () => exportExcel(currentRows));
window.addEventListener("resize", () => { if (currentRows.length) drawChart(currentRows); });

window.addEventListener("DOMContentLoaded", async () => {
  endEl.value        = todayIso();
  loadBtn.disabled   = true;
  exportBtn.disabled = true;
  try {
    await loadDataset();
    await applyFilter();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    showDataUpdated(null);
    loadBtn.disabled = false;
  }
});
