const DATA_URL = "data/lm_hg217_daily_prices.json";

const statusEl         = document.getElementById("status");
const startEl          = document.getElementById("startDate");
const endEl            = document.getElementById("endDate");
const loadBtn          = document.getElementById("loadBtn");
const exportBtn        = document.getElementById("exportBtn");
const latestNationalEl = document.getElementById("latestNational");
const latestIowaMnEl   = document.getElementById("latestIowaMn");
const latestWesternEl  = document.getElementById("latestWestern");
const totalDaysEl      = document.getElementById("totalDays");
const tableBodyEl      = document.getElementById("priceTableBody");
const chartEl          = document.getElementById("priceChart");
const dataUpdatedEl    = document.getElementById("dataUpdated");

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

function fmt(v) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

let fullRows    = [];
let currentRows = [];

async function loadDataset() {
  statusEl.textContent = "Loading dataset…";
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Cannot load ${DATA_URL} (HTTP ${res.status})`);
  const payload = await res.json();
  fullRows = Array.isArray(payload.rows) ? payload.rows : [];
  showDataUpdated(payload.generatedAt);
}

function filterRows(start, end) {
  return fullRows
    .filter((r) => r.date >= start && r.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderTable(rows) {
  tableBodyEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = [
      `<td>${row.date}</td>`,
      `<td class="${row.national != null ? "val-national" : "val-null"}">${fmt(row.national)}</td>`,
      `<td class="${row.iowaMn   != null ? "val-iowamn"   : "val-null"}">${fmt(row.iowaMn)}</td>`,
      `<td class="${row.western  != null ? "val-western"  : "val-null"}">${fmt(row.western)}</td>`,
    ].join("");
    frag.appendChild(tr);
  });
  tableBodyEl.appendChild(frag);
}

function updateMetrics(rows) {
  totalDaysEl.textContent      = String(rows.length);
  const last = rows[rows.length - 1];
  latestNationalEl.textContent = last ? fmt(last.national) : "-";
  latestIowaMnEl.textContent   = last ? fmt(last.iowaMn)   : "-";
  latestWesternEl.textContent  = last ? fmt(last.western)  : "-";
}

const COLORS = { national: "#d97706", iowaMn: "#1d6fca", western: "#1a9e6b" };

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

  const pad = { top: 24, right: 20, bottom: 28, left: 52 };
  const cw  = W - pad.left - pad.right;
  const ch  = H - pad.top  - pad.bottom;

  const series = ["national", "iowaMn", "western"];
  const all    = rows.flatMap((r) => series.map((k) => r[k]).filter((v) => v != null));

  if (!all.length || rows.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px sans-serif";
    ctx.fillText("No data", 16, 22);
    return;
  }

  const minV   = Math.floor(Math.min(...all) - 1);
  const maxV   = Math.ceil(Math.max(...all)  + 1);
  const yScale = (v)   => pad.top  + ((maxV - v)             / (maxV - minV || 1)) * ch;
  const xScale = (idx) => pad.left + (idx                     / (rows.length - 1 || 1)) * cw;

  ctx.strokeStyle = "#e9ecf0";
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 6; i++) {
    const y   = pad.top + (i / 6) * ch;
    const val = maxV - ((maxV - minV) * i) / 6;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(val.toFixed(0), pad.left - 6, y + 4);
  }

  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  const step = Math.max(1, Math.round(rows.length / 14));
  rows.forEach((row, idx) => {
    if (idx % step === 0) {
      ctx.fillText(row.date.slice(0, 7), xScale(idx), H - pad.bottom + 14);
    }
  });

  series.forEach((key) => {
    ctx.strokeStyle = COLORS[key];
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    let started = false;
    rows.forEach((row, idx) => {
      const v = row[key];
      if (v == null) { started = false; return; }
      const x = xScale(idx);
      const y = yScale(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else          { ctx.lineTo(x, y); }
    });
    ctx.stroke();
  });
}

function exportExcel(rows) {
  if (typeof XLSX === "undefined") {
    statusEl.textContent = "SheetJS not loaded. Check internet connection.";
    return;
  }
  const data = [
    ["Date", "National (Neg. Carcass)", "Iowa/MN (Neg. Carcass)", "W. Cornbelt (Neg. Carcass)"],
    ...rows.map((r) => [r.date, r.national, r.iowaMn, r.western]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 26 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "LM_HG217");
  const from = rows[0]?.date ?? "start";
  const to   = rows[rows.length - 1]?.date ?? "end";
  XLSX.writeFile(wb, `LM_HG217_${from}_${to}.xlsx`);
}

async function applyFilter() {
  const start = startEl.value;
  const end   = endEl.value;
  if (!start || !end || start > end) {
    statusEl.textContent = "Choose a valid date range.";
    return;
  }
  loadBtn.disabled   = true;
  exportBtn.disabled = true;
  tableBodyEl.innerHTML = "";

  currentRows = filterRows(start, end);
  renderTable(currentRows);
  updateMetrics(currentRows);
  drawChart(currentRows);

  statusEl.textContent = `${currentRows.length} trading days · ${start} → ${end}`;
  exportBtn.disabled = currentRows.length === 0;
  loadBtn.disabled   = false;
}

loadBtn.addEventListener("click", applyFilter);
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
