const DATA_URL = "data/turkey_hen_weekly.json";

const statusEl = document.getElementById("status");
const startEl = document.getElementById("startDate");
const endEl = document.getElementById("endDate");
const loadBtn = document.getElementById("loadBtn");
const exportBtn = document.getElementById("exportBtn");
const latestBreastEl = document.getElementById("latestBreast");
const totalWeeksEl = document.getElementById("totalWeeks");
const tableBodyEl = document.getElementById("tableBody");
const chartEl = document.getElementById("priceChart");
const dataUpdatedEl = document.getElementById("dataUpdated");
const refreshBtn = document.getElementById("refreshBtn");

function formatDataUpdatedLabel(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    ...(/T\d/.test(s) ? { timeStyle: "short" } : {}),
  }).format(d);
}

function showDataUpdated(iso) {
  if (!dataUpdatedEl) return;
  const label = formatDataUpdatedLabel(iso);
  dataUpdatedEl.hidden = !label;
  dataUpdatedEl.textContent = label ? `Updated: ${label}` : "";
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toIso(mmddyyyy) {
  const [month, day, year] = mmddyyyy.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function fmt(value) {
  return value == null ? "-" : Number(value).toFixed(2);
}

function normalizeRows(rows) {
  const byWeek = new Map();
  const conflicts = new Set();
  for (const raw of rows) {
    if (!raw.week_start || !raw.week_end) continue;
    const key = `${raw.week_start}\0${raw.week_end}`;
    if (conflicts.has(key)) continue;
    const price = raw.breast_wtd_avg == null || raw.breast_wtd_avg === ""
      ? null
      : Number(raw.breast_wtd_avg);
    const record = {
      week_start: raw.week_start,
      week_end: raw.week_end,
      breast_wtd_avg: Number.isFinite(price) ? price : null,
      isoDate: toIso(raw.week_start),
    };
    const existing = byWeek.get(key);
    if (!existing) {
      byWeek.set(key, record);
    } else if (existing.breast_wtd_avg == null && record.breast_wtd_avg != null) {
      byWeek.set(key, record);
    } else if (
      existing.breast_wtd_avg != null &&
      record.breast_wtd_avg != null &&
      existing.breast_wtd_avg !== record.breast_wtd_avg
    ) {
      console.error("[turkey] Conflicting breast prices for one week", {
        week_start: record.week_start,
        week_end: record.week_end,
        prices: [existing.breast_wtd_avg, record.breast_wtd_avg],
      });
      conflicts.add(key);
      byWeek.delete(key);
    }
  }
  return [...byWeek.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

let fullRows = [];
let currentRows = [];

async function loadDataset() {
  statusEl.textContent = "Loading dataset…";
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Cannot load ${DATA_URL} (HTTP ${res.status})`);
  const payload = await res.json();
  fullRows = normalizeRows(Array.isArray(payload.rows) ? payload.rows : []);
  showDataUpdated(payload.generatedAt);
}

function filterRows(start, end) {
  return fullRows.filter((row) => row.isoDate >= start && row.isoDate <= end);
}

function renderTable(rows) {
  tableBodyEl.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const [index, value] of [row.week_start, row.week_end, fmt(row.breast_wtd_avg)].entries()) {
      const td = document.createElement("td");
      td.textContent = value;
      if (index === 2) td.className = row.breast_wtd_avg == null ? "val-null" : "val-breast";
      tr.appendChild(td);
    }
    fragment.appendChild(tr);
  }
  tableBodyEl.appendChild(fragment);
}

function updateMetrics(rows) {
  totalWeeksEl.textContent = String(rows.length);
  const pricedRows = rows.filter((row) => row.breast_wtd_avg != null);
  latestBreastEl.textContent = pricedRows.length
    ? fmt(pricedRows[pricedRows.length - 1].breast_wtd_avg)
    : "-";
}

function drawChart(rows) {
  const dpr = window.devicePixelRatio || 1;
  const rect = chartEl.getBoundingClientRect();
  const width = rect.width || 1100;
  const height = rect.height || 320;
  chartEl.width = width * dpr;
  chartEl.height = height * dpr;
  const ctx = chartEl.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const pricedRows = rows.filter((row) => row.breast_wtd_avg != null);
  if (pricedRows.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px sans-serif";
    ctx.fillText("No data", 16, 22);
    return;
  }

  const pad = { top: 24, right: 20, bottom: 28, left: 56 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const values = pricedRows.map((row) => row.breast_wtd_avg);
  const minValue = Math.floor(Math.min(...values) - 2);
  const maxValue = Math.ceil(Math.max(...values) + 2);
  const yScale = (value) => pad.top + ((maxValue - value) / (maxValue - minValue || 1)) * chartHeight;
  const xScale = (index) => pad.left + (index / (pricedRows.length - 1 || 1)) * chartWidth;

  ctx.strokeStyle = "#e9ecf0";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = pad.top + (i / 6) * chartHeight;
    const value = maxValue - ((maxValue - minValue) * i) / 6;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(0), pad.left - 6, y + 4);
  }

  const step = Math.max(1, Math.round(pricedRows.length / 14));
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  pricedRows.forEach((row, index) => {
    if (index % step === 0) {
      ctx.fillText(row.isoDate.slice(0, 7), xScale(index), height - pad.bottom + 14);
    }
  });

  ctx.strokeStyle = "#c2410c";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  pricedRows.forEach((row, index) => {
    const x = xScale(index);
    const y = yScale(row.breast_wtd_avg);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function exportExcel(rows) {
  if (typeof XLSX === "undefined") {
    statusEl.textContent = "SheetJS not loaded.";
    return;
  }
  const data = [
    ["WEEK START", "WEEK END", "BREAST WTD AVG (¢/lb)"],
    ...rows.map((row) => [row.week_start, row.week_end, row.breast_wtd_avg]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Turkey Breast");
  const from = rows[0]?.week_start ?? "start";
  const to = rows[rows.length - 1]?.week_start ?? "end";
  XLSX.writeFile(workbook, `Turkey_Breast_${from}_${to}.xlsx`);
}

async function applyFilter() {
  const start = startEl.value;
  const end = endEl.value;
  if (!start || !end || start > end) {
    statusEl.textContent = "Choose a valid date range.";
    return;
  }
  loadBtn.disabled = true;
  exportBtn.disabled = true;
  tableBodyEl.replaceChildren();
  currentRows = filterRows(start, end);
  renderTable(currentRows);
  updateMetrics(currentRows);
  drawChart(currentRows);
  statusEl.textContent = `${currentRows.length} weeks · ${start} → ${end}`;
  exportBtn.disabled = currentRows.length === 0;
  loadBtn.disabled = false;
}

loadBtn.addEventListener("click", applyFilter);
exportBtn.addEventListener("click", () => exportExcel(currentRows));
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      statusEl.textContent = `Refresh failed: ${error.message}`;
      refreshBtn.disabled = false;
      return;
    }
    window.location.reload();
  });
}
window.addEventListener("resize", () => {
  if (currentRows.length) drawChart(currentRows);
});

window.addEventListener("DOMContentLoaded", async () => {
  endEl.value = todayIso();
  loadBtn.disabled = true;
  exportBtn.disabled = true;
  try {
    await loadDataset();
    await applyFilter();
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
    showDataUpdated(null);
    loadBtn.disabled = false;
  }
});
